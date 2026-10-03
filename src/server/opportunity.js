// Opportunity engine — decides whether a listing is genuinely under market.
//
// WHY IT WAS REDESIGNED
// The old rubric started every listing at score 55 (even with no market data),
// added bonuses for having a photo, and called anything >= 80 «فرصت عالی». Because
// the baseline itself was wrong (see pricing.js), practically everything looked
// like a bargain — including ads that were in fact OVER market.
//
// The rules below are deliberately conservative. The guiding principle:
//   "No trustworthy baseline → no opportunity claim."
// A listing must clear every hard gate, then beat the market by a margin that is
// statistically meaningful for its own cohort, before it can be called a فرصت.

import { normalizeYear } from './vehicle-identity.js'
import { detectDealer } from './dealer.js'

export const CURRENT_JALALI_YEAR = 1405

/**
 * The visibility band.
 *
 * Operators asked for a hard rule: a listing between `min`% and `max`% under the
 * market is a real opportunity and belongs on the site. Anything CHEAPER than
 * `max`% is not a bargain — at that distance from a trustworthy cohort the number
 * is almost always a down payment, a «حواله», or a dealer hook. Those go to the
 * «مشکوک» bucket and are hidden until the visitor explicitly opts in.
 *
 * Read lazily so a host can retune without a redeploy:
 *   OPPORTUNITY_MIN_DISCOUNT=15  OPPORTUNITY_MAX_DISCOUNT=30  HIDE_DEALER_ADS=true
 */
export function visibilityBand(env = process.env) {
  const min = Number(env.OPPORTUNITY_MIN_DISCOUNT)
  const max = Number(env.OPPORTUNITY_MAX_DISCOUNT)
  return {
    min: Number.isFinite(min) && min > 0 ? min : 15,
    max: Number.isFinite(max) && max > 0 ? max : 30,
    hideDealers: env.HIDE_DEALER_ADS !== 'false',
  }
}

/**
 * Display tiers, in the spirit of دلال: a listing is not simply «good», it carries
 * a badge that says how far under the market it sits and how much we trust that.
 * `cap` is the highest score a listing in that tier may ever reach, which is what
 * stops the whole board from turning gold.
 */
export const TIERS = {
  golden: { key: 'golden', label: 'فرصت طلایی', marker: '★', short: 'طلایی', color: '#b8860b', cap: 99 },
  silver: { key: 'silver', label: 'زیر قیمت بازار', marker: '◆', short: 'نقره‌ای', color: '#2e7d5b', cap: 84 },
  bronze: { key: 'bronze', label: 'کمی زیر بازار', marker: '●', short: 'برنزی', color: '#4a6b8a', cap: 74 },
  fair: { key: 'fair', label: 'قیمت بازار', marker: '=', short: 'منصفانه', color: '#5a6572', cap: 62 },
  above: { key: 'above', label: 'بالاتر از بازار', marker: '▲', short: 'گران', color: '#a85b32', cap: 45 },
  high: { key: 'high', label: 'بسیار گران‌تر از بازار', marker: '▲▲', short: 'خیلی گران', color: '#8c2f2f', cap: 30 },
  suspicious: { key: 'suspicious', label: 'مشکوک یا شرکتی', marker: '!', short: 'مشکوک', color: '#b3261e', cap: 20 },
  unknown: { key: 'unknown', label: 'داده بازار کافی نیست', marker: '—', short: 'بدون داده', color: '#8a8f98', cap: 50 },
}

// Per-segment plausibility envelopes used by the hard gates.
const SEGMENT_RULES = {
  light: { maxKm: 900000, minYear: 1345, absurdlyCheap: 0.35, priceFloor: 20_000_000 },
  heavy: { maxKm: 3_000_000, minYear: 1335, absurdlyCheap: 0.4, priceFloor: 100_000_000 },
  motorcycle: { maxKm: 250000, minYear: 1360, absurdlyCheap: 0.4, priceFloor: 3_000_000 },
}
const rulesFor = segment => SEGMENT_RULES[segment] || SEGMENT_RULES.light

// How much a cohort level is allowed to contribute to confidence. A whole-model
// comparison can never be as trustworthy as same-model-same-year-same-colour.
const LEVEL_TRUST = { color: 1, year: 0.9, yearBand: 0.75, model: 0.5 }

// The single most important guard-rail: a cohort this broad may never produce a
// top-tier opportunity, no matter how cheap the ad looks.
const MAX_GRADE_BY_LEVEL = { color: 'exceptional', year: 'exceptional', yearBand: 'strong', model: 'slight' }

const GRADE_ORDER = ['overpriced_high', 'overpriced', 'fair', 'slight', 'strong', 'exceptional']
const GRADE_LABELS = {
  exceptional: 'فرصت استثنایی',
  strong: 'فرصت خوب',
  slight: 'کمی زیر بازار',
  fair: 'قیمت منصفانه',
  overpriced: 'بالاتر از بازار',
  overpriced_high: 'بسیار گران‌تر از بازار',
}
const capGrade = (grade, level) => {
  const cap = MAX_GRADE_BY_LEVEL[level] || 'slight'
  return GRADE_ORDER.indexOf(grade) > GRADE_ORDER.indexOf(cap) ? cap : grade
}

const clamp = (value, min, max) => Math.min(max, Math.max(min, value))

/**
 * Pull a raw score under its tier's ceiling WITHOUT flattening the tier.
 *
 * A hard `Math.min(score, cap)` would give every listing in a crowded tier the
 * identical number, destroying the ranking inside it (two listings 20% apart would
 * both read «۲۰»). Scores below 80% of the ceiling pass through untouched; the rest
 * are compressed into the remaining head-room, so order is always preserved.
 */
export function capToTier(raw, cap) {
  const score = clamp(Number(raw) || 0, 1, 99)
  const soft = cap * 0.8
  if (score <= soft) return Math.round(score)
  const ratio = (score - soft) / Math.max(1, 99 - soft)
  return Math.round(soft + ratio * (cap - soft))
}

function ageHours(text = '') {
  const normalized = String(text || '').replace(/[۰-۹]/g, d => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d))
  if (/لحظ|دقیق/.test(normalized)) return 0.2
  const n = Number((normalized.match(/\d+/) || [1])[0])
  if (normalized.includes('ساعت')) return n
  if (normalized.includes('روز')) return n * 24
  if (normalized.includes('هفته')) return n * 168
  if (normalized.includes('ماه')) return n * 720
  return 48
}

const INSTALMENT_RE = /پیش.?پرداخت|اقساط|قسط|بیعانه|تحویل حواله|حواله|مشارکت|پیش.?فروش|لیزینگ/
const SWAP_RE = /معاوضه|تهاتر/

/**
 * Hard gates. Any hit means the listing is NOT eligible to be presented as an
 * opportunity — it is either unverifiable, mispriced, or not a whole-vehicle sale.
 */
export function hardGates(item, valuation) {
  const flags = []
  const segment = valuation?.identity?.segment || item.identity?.segment || 'light'
  const rules = rulesFor(segment)
  const price = Number(item.price) || 0
  const year = normalizeYear(item.year) || 0
  const km = Number(item.km) || 0

  if (!price) flags.push({ code: 'NO_PRICE', text: 'آگهی قیمت ندارد (توافقی)' })
  else if (price < rules.priceFloor) flags.push({ code: 'PRICE_TOO_LOW', text: 'مبلغ درج‌شده برای این دسته غیرواقعی است' })
  if (!item.image) flags.push({ code: 'NO_PHOTO', text: 'آگهی تصویر ندارد' })
  if (INSTALMENT_RE.test(item.title || '')) flags.push({ code: 'INSTALMENT', text: 'احتمالاً قیمت کامل خودرو نیست (اقساطی/حواله/پیش‌فروش)' })
  if (SWAP_RE.test(item.title || '')) flags.push({ code: 'SWAP', text: 'آگهی معاوضه است و قیمت آن مبنای بازار نیست' })
  if (year && (year > CURRENT_JALALI_YEAR + 1 || year < rules.minYear)) flags.push({ code: 'BAD_YEAR', text: 'سال ساخت معتبر نیست' })
  if (km && km > rules.maxKm) flags.push({ code: 'BAD_KM', text: 'کارکرد ثبت‌شده غیرعادی است' })
  return flags
}

/**
 * Score one listing.
 * Returns a normalised verdict. `score` is null whenever we have no trustworthy
 * baseline, so the UI can say «داده کافی نیست» instead of printing a number.
 */
export function evaluateListing(item, valuation, { now = Date.now(), screen = null, env = process.env, sellerAdCount = 0 } = {}) {
  const band = visibilityBand(env)
  const dealer = detectDealer(item, { sellerAdCount })
  const gateFlags = hardGates(item, valuation)
  // A listing the fraud screen rejected can never be an opportunity, whatever the
  // statistics say — its price is not a real cash price for the whole car.
  if (screen && screen.severity !== 'ok') {
    for (const flag of screen.flags) gateFlags.push({ code: flag.code, text: flag.text })
  }
  const price = Number(item.price) || 0

  // --- no baseline: we refuse to guess -------------------------------------
  if (!valuation || !valuation.median) {
    const unknownHidden = gateFlags.length > 0 || (band.hideDealers && dealer.dealer)
    return {
      score: null, grade: 'unknown', label: 'داده بازار کافی نیست',
      tier: unknownHidden ? TIERS.suspicious.key : TIERS.unknown.key,
      tierLabel: unknownHidden ? TIERS.suspicious.label : TIERS.unknown.label,
      tierMarker: unknownHidden ? TIERS.suspicious.marker : TIERS.unknown.marker,
      tierShort: unknownHidden ? TIERS.suspicious.short : TIERS.unknown.short,
      tierColor: unknownHidden ? TIERS.suspicious.color : TIERS.unknown.color,
      hidden: unknownHidden,
      hiddenReasons: unknownHidden
        ? (gateFlags.length ? [{ code: gateFlags[0].code, text: gateFlags[0].text }] : [{ code: 'DEALER_AD', text: 'آگهی شرکتی/نمایشگاهی' }])
        : [],
      hiddenReason: unknownHidden ? (gateFlags[0]?.text || 'آگهی شرکتی/نمایشگاهی') : '',
      dealer: dealer.dealer, dealerConfidence: dealer.confidence, dealerSignals: dealer.signals, band,
      market: 0, marketAvg: 0, discount: 0, deviation: 0,
      level: 'none', levelLabel: '', samples: 0, confidence: 0,
      eligible: false, suspicious: gateFlags.length > 0, riskFlags: gateFlags.map(f => f.text), gateCodes: gateFlags.map(f => f.code),
      reason: 'برای این خودرو در بازهٔ ۳۰ روز گذشته نمونهٔ کافی و هم‌جنس پیدا نشد.',
    }
  }

  const market = valuation.median
  const discount = ((market - price) / market) * 100            // + = cheaper than market
  // Robust standard score: how unusual is this price INSIDE its own cohort.
  const sigma = valuation.mad ? valuation.mad * 1.4826 : (valuation.p75 - valuation.p25) / 1.349 || 0
  const z = sigma ? (price - market) / sigma : 0                // negative = cheaper
  const rules = rulesFor(valuation.identity?.segment)

  // --- confidence -----------------------------------------------------------
  const sampleStrength = clamp(valuation.samples / 25, 0.2, 1)
  const levelTrust = LEVEL_TRUST[valuation.level] ?? 0.5
  const tightness = clamp(1 - valuation.dispersion, 0.2, 1)
  const completeness = [item.image, item.title, item.city, normalizeYear(item.year), Number(item.km) > 0, item.color && item.color !== '—'].filter(Boolean).length / 6
  const freshness = clamp(1 - ageHours(item.freshness) / 336, 0, 1)
  const confidence = Math.round(clamp(sampleStrength * 0.3 + levelTrust * 0.3 + tightness * 0.2 + completeness * 0.1 + freshness * 0.1, 0, 1) * 100)

  // --- too good to be true --------------------------------------------------
  // A price far under a TRUSTED cohort is a fraud signal, not a bargain.
  const riskFlags = gateFlags.map(f => f.text)
  const gateCodes = gateFlags.map(f => f.code)
  // Past the top of the visibility band the gap stops being a bargain and starts
  // being evidence that the number is not the cash price of the whole car.
  if (discount > band.max && valuation.samples >= 8) {
    riskFlags.push(`قیمت ${Math.round(discount)}٪ زیر بازارِ ${valuation.label} است؛ اختلاف بیش از ${band.max}٪ واقعی نیست`)
    gateCodes.push('TOO_CHEAP')
  } else if (discount >= rules.absurdlyCheap * 100 && valuation.samples < 8) {
    // Thin cohort: we cannot prove it, but we will not advertise it either.
    riskFlags.push(`قیمت ${Math.round(discount)}٪ زیر نمونه‌های موجود است و نمونهٔ کافی برای تأیید نداریم`)
    gateCodes.push('TOO_CHEAP_THIN')
  }
  // The mirror case matters just as much: a price far ABOVE a trusted cohort is
  // either a typo, a different vehicle wearing the same title, or gouging. Either
  // way it must never sit quietly in the results as a normal ad.
  if (discount <= -60 && valuation.samples >= 8) {
    riskFlags.push(`قیمت ${Math.round(Math.abs(discount))}٪ بالاتر از بازارِ ${valuation.label} است`)
    gateCodes.push('TOO_EXPENSIVE')
  }
  // A big z-score alone is not enough: in a very tight cohort even a healthy 10%
  // bargain scores a huge z. Demand a materially large gap too, otherwise genuine
  // opportunities would be buried under false fraud warnings.
  if (Math.abs(z) >= 3.5 && Math.abs(discount) >= 20 && valuation.samples >= 10) {
    riskFlags.push('قیمت خارج از الگوی آماری نمونه‌های مشابه است')
    gateCodes.push('STAT_OUTLIER')
  }

  const screenRejected = screen?.severity === 'reject'
  const suspicious = riskFlags.length > 0
  const eligible = !suspicious && !screenRejected && screen?.severity !== 'review' && confidence >= 45 && valuation.samples >= 5

  // --- grade ----------------------------------------------------------------
  // Both a meaningful percentage AND statistical significance are required, so a
  // 6% gap inside a cohort that naturally swings 30% is correctly called "fair".
  let grade = 'fair'
  if (discount >= 18 && z <= -1.0) grade = 'exceptional'
  else if (discount >= 10 && z <= -0.6) grade = 'strong'
  else if (discount >= 4 && z <= -0.25) grade = 'slight'
  else if (discount <= -25) grade = 'overpriced_high'
  else if (discount <= -8) grade = 'overpriced'
  if (GRADE_ORDER.indexOf(grade) > GRADE_ORDER.indexOf('fair')) grade = capGrade(grade, valuation.level)
  if (suspicious) grade = 'fair'

  // --- display tier ---------------------------------------------------------
  // The tier is what the visitor actually sees. It is deliberately stricter than
  // the statistical grade: the top badge additionally demands that the listing be
  // eligible (clean screen, trustworthy cohort) and inside the visibility band.
  const trustedCohort = valuation.samples >= 8
  const deepDiscount = discount > band.max && trustedCohort
  const hideForDealer = band.hideDealers && dealer.dealer && discount >= band.min

  let tier
  if (screenRejected || suspicious || deepDiscount || hideForDealer) tier = TIERS.suspicious
  else if (discount >= band.min && discount <= band.max && z <= -1.0 && eligible) tier = TIERS.golden
  else if (discount >= 8 && z <= -0.6) tier = TIERS.silver
  else if (discount >= 3 && z <= -0.25) tier = TIERS.bronze
  else if (discount <= -25) tier = TIERS.high
  else if (discount <= -8) tier = TIERS.above
  else tier = TIERS.fair

  // A listing inside the golden band that cannot clear the trust bar must not be
  // silently promoted to silver — it drops a step instead.
  if (tier === TIERS.silver && discount >= band.min && !eligible) tier = TIERS.bronze

  // --- visibility -----------------------------------------------------------
  // Hidden listings still exist in the API (users search for them, and the count
  // is published) but the default feed excludes them.
  const hiddenReasons = []
  if (screenRejected) hiddenReasons.push({ code: 'SCREEN_REJECT', text: 'غربالگری قیمت این آگهی را رد کرده است' })
  if (deepDiscount) hiddenReasons.push({ code: 'DEEP_DISCOUNT', text: `اختلاف ${Math.round(discount)}٪ با بازار از سقف ${band.max}٪ بیشتر است` })
  if (hideForDealer) hiddenReasons.push({ code: 'DEALER_AD', text: 'آگهی شرکتی/نمایشگاهی با قیمت پایین‌تر از بازار' })
  if (suspicious && !hiddenReasons.length) hiddenReasons.push({ code: 'RISK_FLAGS', text: riskFlags[0] })
  const hidden = hiddenReasons.length > 0

  // --- score ----------------------------------------------------------------
  // 50 = exactly at market. Movement away from 50 is driven by the robust z-score
  // (capped), then scaled by confidence so thin evidence cannot reach the top, and
  // finally capped by the tier — which is what prevents a board full of 100s.
  const positional = clamp(50 + clamp(-z, -2.5, 2.5) * 16, 5, 95)
  let score = Math.round(positional * (0.55 + 0.45 * (confidence / 100)))
  if (suspicious) score = Math.min(score, 30)
  if (screenRejected) score = Math.min(score, 12)
  if (!eligible) score = Math.min(score, 58)
  score = capToTier(score, tier.cap)
  score = Math.round(clamp(score, 1, 99))

  return {
    score,
    grade: suspicious ? 'suspicious' : grade,
    tier: tier.key,
    tierLabel: tier.label,
    tierMarker: tier.marker,
    tierShort: tier.short,
    tierColor: tier.color,
    hidden,
    hiddenReasons,
    hiddenReason: hiddenReasons[0]?.text || '',
    dealer: dealer.dealer,
    dealerConfidence: dealer.confidence,
    dealerSignals: dealer.signals,
    band,
    label: screenRejected ? 'قیمت غیرواقعی یا اقساطی' : suspicious ? 'مشکوک؛ نیازمند بررسی' : tier.label,
    market,
    marketAvg: valuation.avg,
    marketP25: valuation.p25,
    marketP75: valuation.p75,
    discount: Number(discount.toFixed(1)),
    deviation: Number(z.toFixed(2)),
    level: valuation.level,
    levelLabel: valuation.label,
    samples: valuation.samples,
    dispersion: valuation.dispersion,
    confidence,
    eligible,
    suspicious,
    riskFlags,
    gateCodes,
    reason: suspicious
      ? riskFlags[0]
      : `${valuation.samples} آگهی هم‌جنس (${valuation.label}) در ۳۰ روز گذشته؛ میانهٔ بازار ${Math.round(market / 1e6).toLocaleString('fa-IR')} میلیون تومان.`,
  }
}

export const GRADES = GRADE_LABELS
