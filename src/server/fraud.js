// Fraud / bait-price screen.
//
// THE PROBLEM
// Dealers post deliberately wrong prices to farm phone calls:
//   · «کوییک ۵۸۰ میلیون» when every Quick ever built is worth ≥ ۷۲۰ میلیون
//   · instalment deals where only the FIRST payment is written in the price field
//   · «قیمت توافقی» ads carrying a token number
// These ads do triple damage: they drag the average down, they show users
// impossible prices, and they crowd out genuine listings.
//
// THE FIX
// Every listing is screened BEFORE it may contribute to a market average. A listing
// that fails the screen is still shown (users search for it) but is labelled, ranked
// down, and — critically — excluded from the baseline.
//
// Severity levels:
//   'reject'  → never counted in an average, shown with a red warning
//   'review'  → not counted in an average, shown with a caution note
//   'ok'      → trusted, counted

import { identifyVehicle, normalizeYear, normalizeText } from './vehicle-identity.js'

// --- 1) Instalment / non-cash language -------------------------------------
// Each pattern means "the number in the price field is probably not the car price".
const INSTALMENT_PATTERNS = [
  { re: /قسط|اقساط|اقساطی/, code: 'INSTALMENT', text: 'آگهی اقساطی است؛ مبلغ درج‌شده احتمالاً قیمت کامل خودرو نیست' },
  { re: /پیش.?پرداخت|پیش.?قسط|پیش.?دریافت/, code: 'DOWNPAYMENT', text: 'مبلغ درج‌شده احتمالاً پیش‌پرداخت است، نه قیمت خودرو' },
  { re: /بیعانه|ودیعه/, code: 'DEPOSIT', text: 'مبلغ درج‌شده بیعانه است' },
  { re: /ماهیانه|ماهانه|هر ماه|چک ماه/, code: 'MONTHLY', text: 'مبلغ درج‌شده احتمالاً قسط ماهانه است' },
  { re: /حواله|پیش.?فروش|ثبت.?نام|قرعه.?کشی/, code: 'ALLOCATION', text: 'آگهی حواله/پیش‌فروش است و قیمت آن مبنای بازار نیست' },
  { re: /لیزینگ|وام|تسهیلات|ضامن|چک صیاد/, code: 'FINANCE', text: 'فروش تسهیلاتی؛ مبلغ درج‌شده قیمت نقدی نیست' },
  { re: /مشارکت|سرمایه.?گذاری/, code: 'PARTNERSHIP', text: 'آگهی مشارکتی است' },
  { re: /معاوضه|تهاتر/, code: 'SWAP', text: 'آگهی معاوضه است و قیمت آن مبنای بازار نیست' },
  { re: /اجاره|کرایه|دربست/, code: 'RENTAL', text: 'آگهی اجاره است، نه فروش' },
  { re: /اوراق|اسقاط|مدارک|برگ سبز|سند تک برگ فروشی|فقط بدنه|بدون موتور/, code: 'PARTS', text: 'آگهی مربوط به اوراق/مدارک است، نه خودروی سالم' },
]

// --- 2) Bait-number shapes --------------------------------------------------
// Call-farming ads often use placeholder numbers instead of a real price.
const BAIT_NUMBERS = [
  111_111_111, 123_456_789, 999_999_999, 1_111_111_111, 123_123_123,
  100_000_000, 111_000_000, 123_000_000,
]

function looksLikeBaitNumber(price) {
  if (BAIT_NUMBERS.includes(price)) return true
  const digits = String(price)
  // 11111111, 12345678, 98765432 …
  if (/^(\d)\1{5,}$/.test(digits)) return true
  if (/^123456789?0*$/.test(digits) || /^987654321?0*$/.test(digits)) return true
  return false
}

// How far below the published reference value an ad may sit before we stop
// believing it. A rough, high-mileage, repainted car can legitimately trade well
// under the «سالم و بی‌رنگ» reference — but not by 45%.
export const CURRENT_JALALI_YEAR = 1405

// How far below the published reference value an ad may sit before we stop
// believing it — scaled by the car's age.
//
// A newish car has a tight, liquid market: nobody sells a 3-year-old Quick for 45%
// under book value, so a big gap means the number is not a real cash price. An old,
// high-mileage car genuinely can trade far under the «سالم و بی‌رنگ» reference, so
// the tolerance widens with age to avoid punishing honest ads.
export function referenceTolerance(year, { now = CURRENT_JALALI_YEAR } = {}) {
  const age = year ? Math.max(0, now - year) : 99
  if (age <= 3) return { reject: 0.70, review: 0.82 }
  if (age <= 8) return { reject: 0.62, review: 0.76 }
  if (age <= 15) return { reject: 0.55, review: 0.70 }
  return { reject: 0.45, review: 0.62 }
}

export const FLOOR_TOLERANCE = 0.55

/**
 * Screen one listing.
 * @param item      normalised listing
 * @param reference reference index (from reference/index.js); may be empty
 * @param cohort    optional stats of the listing's own Divar cohort
 */
export function screenListing(item, { reference = null, cohort = null } = {}) {
  const flags = []
  const price = Number(item.price) || 0
  const title = String(item.title || '')
  const haystack = normalizeText(`${title} ${item.description || ''} ${item.priceText || ''}`)
  const identity = item.identity || identifyVehicle(title, item.category || 'light')
  const year = normalizeYear(item.year) || 0

  // -- no usable price --------------------------------------------------------
  if (!price) {
    return { severity: 'review', clean: false, flags: [{ code: 'NO_PRICE', text: 'آگهی قیمت ندارد (توافقی)' }], reference: null }
  }
  if (looksLikeBaitNumber(price)) {
    flags.push({ code: 'BAIT_NUMBER', text: 'عدد قیمت ساختگی است (برای جذب تماس درج شده)' })
  }

  // -- instalment / non-cash language ----------------------------------------
  const languageHits = INSTALMENT_PATTERNS.filter(pattern => pattern.re.test(haystack))
  for (const hit of languageHits) flags.push({ code: hit.code, text: hit.text })

  // -- reference-price comparison (the decisive signal) ----------------------
  let referenceInfo = null
  if (reference && reference.has?.(identity.key)) {
    const match = reference.priceFor(identity.key, year)
    if (match) {
      const ratio = price / match.price
      const tolerance = referenceTolerance(year || match.year)
      referenceInfo = { price: match.price, year: match.year, exact: match.exact, ratio: Number(ratio.toFixed(3)), sources: match.sources, tolerance }
      if (ratio < tolerance.reject) {
        flags.push({
          code: 'BELOW_REFERENCE',
          text: `قیمت ${Math.round((1 - ratio) * 100)}٪ پایین‌تر از قیمت مرجع بازار (${Math.round(match.price / 1e6).toLocaleString('fa-IR')} میلیون) است`,
        })
      } else if (ratio < tolerance.review) {
        flags.push({ code: 'UNDER_REFERENCE', text: 'قیمت به‌طور قابل‌توجهی زیر قیمت مرجع بازار است؛ نیاز به بررسی دارد' })
      }
      const ceiling = reference.ceilingFor(identity.key)
      if (ceiling && price > ceiling * 2.2) {
        flags.push({ code: 'ABOVE_REFERENCE', text: 'قیمت به‌طور غیرعادی بالاتر از گران‌ترین نسخهٔ این مدل است' })
      }
    } else {
      // Model is known to the reference but this build year is not: fall back to
      // the cheapest valuation the model has ever had.
      const floor = reference.floorFor(identity.key)
      if (floor && price < floor * FLOOR_TOLERANCE) {
        flags.push({
          code: 'BELOW_MODEL_FLOOR',
          text: `قیمت از ارزان‌ترین نسخهٔ ${identity.label} در بازار (${Math.round(floor / 1e6).toLocaleString('fa-IR')} میلیون) هم کمتر است`,
        })
      }
    }
  }

  // -- instalment inference without explicit wording -------------------------
  // A price that is a small, round fraction of the reference is almost always a
  // down-payment even when the seller avoided the word «قسط».
  if (referenceInfo && referenceInfo.ratio < 0.4 && price % 10_000_000 === 0) {
    flags.push({ code: 'LIKELY_DOWNPAYMENT', text: 'الگوی مبلغ با پیش‌پرداخت اقساطی هم‌خوانی دارد' })
  }

  // -- cohort cross-check (works even with no reference data) ----------------
  if (!referenceInfo && cohort && cohort.median && cohort.samples >= 8) {
    const ratio = price / cohort.median
    if (ratio < 0.45) flags.push({ code: 'BELOW_COHORT', text: 'قیمت به‌شکل غیرعادی زیر آگهی‌های مشابه است' })
  }

  // -- verdict ---------------------------------------------------------------
  const codes = new Set(flags.map(flag => flag.code))
  const hardCodes = ['BELOW_REFERENCE', 'BELOW_MODEL_FLOOR', 'BAIT_NUMBER', 'LIKELY_DOWNPAYMENT', 'RENTAL', 'PARTS', 'ALLOCATION', 'SWAP']
  const softCodes = ['UNDER_REFERENCE', 'BELOW_COHORT', 'ABOVE_REFERENCE', 'NO_PRICE']

  // Instalment language alone is a reject only when the money also looks wrong;
  // many honest dealers write «نقد و اقساط» on an ad whose price IS the cash price.
  const instalmentLanguage = ['INSTALMENT', 'DOWNPAYMENT', 'DEPOSIT', 'MONTHLY', 'FINANCE', 'PARTNERSHIP'].filter(code => codes.has(code))
  const priceLooksWrong = hardCodes.some(code => codes.has(code)) || codes.has('UNDER_REFERENCE') || codes.has('BELOW_COHORT')

  let severity = 'ok'
  if (hardCodes.some(code => codes.has(code))) severity = 'reject'
  else if (instalmentLanguage.length && priceLooksWrong) severity = 'reject'
  else if (instalmentLanguage.length) severity = 'review'
  else if (softCodes.some(code => codes.has(code))) severity = 'review'

  return { severity, clean: severity === 'ok', flags, reference: referenceInfo, identity }
}

/**
 * Screen a whole crawl. Returns the clean subset for averaging plus per-item
 * verdicts for display.
 */
export function screenAll(items, { reference = null, cohortStats = null } = {}) {
  const verdicts = new Map()
  let rejected = 0, review = 0
  for (const item of items || []) {
    const cohort = cohortStats?.get?.(item.identity?.key || identifyVehicle(item.title, item.category || 'light').key) || null
    const verdict = screenListing(item, { reference, cohort })
    verdicts.set(item.id ?? item.token, verdict)
    if (verdict.severity === 'reject') rejected += 1
    else if (verdict.severity === 'review') review += 1
  }
  return {
    verdicts,
    clean: (items || []).filter(item => verdicts.get(item.id ?? item.token)?.clean),
    stats: { total: items?.length || 0, rejected, review, clean: (items?.length || 0) - rejected - review },
  }
}
