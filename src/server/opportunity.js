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

export const CURRENT_JALALI_YEAR = 1405

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
export function evaluateListing(item, valuation, { now = Date.now(), screen = null } = {}) {
  const gateFlags = hardGates(item, valuation)
  // A listing the fraud screen rejected can never be an opportunity, whatever the
  // statistics say — its price is not a real cash price for the whole car.
  if (screen && screen.severity !== 'ok') {
    for (const flag of screen.flags) gateFlags.push({ code: flag.code, text: flag.text })
  }
  const price = Number(item.price) || 0

  // --- no baseline: we refuse to guess -------------------------------------
  if (!valuation || !valuation.median) {
    return {
      score: null, grade: 'unknown', label: 'داده بازار کافی نیست',
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
  if (discount >= rules.absurdlyCheap * 100 && valuation.samples >= 8) {
    riskFlags.push(`قیمت ${Math.round(discount)}٪ زیر بازارِ ${valuation.label} است؛ این اختلاف غیرعادی است`)
    gateCodes.push('TOO_CHEAP')
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

  // --- score ----------------------------------------------------------------
  // 50 = exactly at market. Movement away from 50 is driven by the robust z-score
  // (capped), then scaled by confidence so thin evidence cannot reach the top.
  const positional = clamp(50 + clamp(-z, -2.5, 2.5) * 16, 5, 95)
  let score = Math.round(positional * (0.55 + 0.45 * (confidence / 100)))
  if (suspicious) score = Math.min(score, 30)
  if (screenRejected) score = Math.min(score, 12)
  if (!eligible) score = Math.min(score, 58)
  score = Math.round(clamp(score, 1, 99))

  return {
    score,
    grade: suspicious ? 'suspicious' : grade,
    label: screenRejected ? 'قیمت غیرواقعی یا اقساطی' : suspicious ? 'مشکوک؛ نیازمند بررسی' : GRADE_LABELS[grade],
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
