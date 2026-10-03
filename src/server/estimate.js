// «تخمین قیمت خودروی من» — value a car the user describes, not one that is for sale.
//
// Everything needed already exists: the vehicle-identity resolver, the rolling
// 30-day baseline and the reference prices. This module just combines them into a
// single honest answer, including the cases where we must say "we don't know".

import { identifyVehicle, normalizeYear, baseColor } from './vehicle-identity.js'
import { valuate } from './pricing.js'

// Mileage adjustment. Reference valuations assume a typical annual mileage; a car
// far above or below that is worth correspondingly less or more.
const TYPICAL_KM_PER_YEAR = 20000
const KM_SENSITIVITY = 0.12        // ±12% at double / zero the expected mileage
const MAX_KM_ADJUST = 0.18

// Body-condition multipliers, matching the options the UI already offers.
const BODY_FACTORS = {
  'بدون رنگ': 1.0,
  'یک لکه رنگ': 0.955,
  'چند لکه رنگ': 0.9,
  'دور رنگ': 0.82,
  'تصادفی': 0.72,
}

export function mileageFactor(km, year, { now = 1405 } = {}) {
  const mileage = Number(km) || 0
  const buildYear = normalizeYear(year) || 0
  if (!mileage || !buildYear) return 1
  const age = Math.max(1, now - buildYear)
  const expected = age * TYPICAL_KM_PER_YEAR
  if (!expected) return 1
  const ratio = mileage / expected
  // ratio 1 → no change; ratio 2 → -12%; ratio 0 → +12%
  const raw = (1 - ratio) * KM_SENSITIVITY
  return 1 + Math.max(-MAX_KM_ADJUST, Math.min(MAX_KM_ADJUST, raw))
}

/**
 * Estimate a vehicle's current market value.
 * @param input  { title | brand+model, year, km, color, body, category }
 * @param deps   { priceIndex, reference }
 */
export function estimateValue(input = {}, { priceIndex = null, reference = null } = {}) {
  const category = input.category || 'light'
  const title = input.title || [input.brand, input.model].filter(Boolean).join(' ')
  const identity = identifyVehicle(title, category)
  const year = normalizeYear(input.year) || 0
  const color = baseColor(input.color)
  const km = Number(input.km) || 0
  const body = input.body || 'بدون رنگ'

  if (!identity.confident) {
    return { ok: false, reason: 'MODEL_UNKNOWN', message: 'مدل خودرو شناسایی نشد؛ نام برند و مدل را دقیق‌تر بنویسید.', identity }
  }

  const sources = []

  // --- 1) our own 30-day market, if it has a trustworthy cohort --------------
  let marketValue = 0, marketInfo = null
  if (priceIndex) {
    const valuation = valuate({ title, year, color, identity }, priceIndex, { categoryHint: category })
    if (valuation) {
      marketValue = valuation.median
      marketInfo = { level: valuation.level, label: valuation.label, samples: valuation.samples, p25: valuation.p25, p75: valuation.p75 }
      sources.push({ kind: 'listings', label: `آگهی‌های ۳۰ روز اخیر (${valuation.label})`, value: valuation.median, samples: valuation.samples })
    }
  }

  // --- 2) published reference price -----------------------------------------
  let referenceValue = 0, referenceInfo = null
  if (reference?.has?.(identity.key)) {
    const match = reference.priceFor(identity.key, year)
    if (match) {
      referenceValue = match.price
      referenceInfo = { price: match.price, year: match.year, exact: match.exact, sources: match.sources }
      sources.push({ kind: 'reference', label: `قیمت مرجع بازار${match.exact ? '' : ` (سال ${match.year})`}`, value: match.price, samples: null })
    }
  }

  if (!marketValue && !referenceValue) {
    return {
      ok: false, reason: 'NO_DATA', identity,
      message: `برای ${identity.label}${year ? ` مدل ${year}` : ''} هنوز دادهٔ کافی نداریم. چند روز دیگر دوباره تلاش کنید.`,
    }
  }

  // --- 3) combine -----------------------------------------------------------
  // The published reference is more stable; our own listings are more current.
  // When both exist, lean on the reference but let the live market move it.
  const base = marketValue && referenceValue
    ? Math.round(referenceValue * 0.6 + marketValue * 0.4)
    : (referenceValue || marketValue)

  const kmFactor = mileageFactor(km, year)
  const bodyFactor = BODY_FACTORS[body] ?? 1
  const estimate = Math.round(base * kmFactor * bodyFactor)

  // --- 4) honest uncertainty -------------------------------------------------
  // Wider when we have one source, when mileage is unknown, or when the cohort is
  // thin. Never present a single number as if it were exact.
  let spread = 0.08
  if (!marketValue || !referenceValue) spread += 0.04
  if (!km) spread += 0.03
  if (marketInfo && marketInfo.samples < 10) spread += 0.03
  if (!year) spread += 0.05

  return {
    ok: true,
    identity: { key: identity.key, label: identity.label, segment: identity.segment, brand: identity.brand, model: identity.model },
    year,
    color: color || null,
    km,
    body,
    estimate,
    range: { low: Math.round(estimate * (1 - spread)), high: Math.round(estimate * (1 + spread)) },
    confidence: Math.round(Math.max(0, 1 - spread * 4) * 100),
    adjustments: {
      mileage: Number(kmFactor.toFixed(3)),
      body: bodyFactor,
      note: km ? null : 'کارکرد وارد نشده؛ تخمین بر مبنای کارکرد متعارف است.',
    },
    basis: { market: marketValue || null, reference: referenceValue || null, marketInfo, referenceInfo },
    sources,
  }
}
