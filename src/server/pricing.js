// Market pricing engine — rolling 30-day baseline per (model, year, colour).
//
// WHAT WAS WRONG BEFORE
//  1. Cohorts merged different vehicles (see vehicle-identity.js), so "the average"
//     was the average of unrelated cars.
//  2. trimOutliers() kept only prices within median*0.45 … median*1.6. On a mixed
//     cohort that silently DELETED the real market and reported the leftover clump
//     as authoritative — e.g. minibus avg "800م" computed after throwing away every
//     modern bus in the pool.
//  3. Minimum sample sizes were 3/3/5 — far too low to call something "the market".
//  4. A listing with no usable cohort still received score 54 and could surface as
//     an opportunity.
//  5. Nothing was time-bounded: a six-month-old crawl counted as today's market.
//
// The engine below is time-windowed, uses quartile-based robust statistics, keeps
// segment/brand/model/year/colour separation, and refuses to price a listing when
// the evidence is too thin instead of inventing a number.

import { identifyVehicle, normalizeYear, baseColor } from './vehicle-identity.js'
import { screenListing } from './fraud.js'

export const DEFAULT_WINDOW_DAYS = 30

// Minimum comparable sample sizes. Deliberately strict: a "market average" built
// from 3 ads is not a market average.
export const MIN_SAMPLES = { color: 5, year: 6, yearBand: 8, model: 12 }

// Maximum relative spread (IQR / median) a cohort may have before we treat it as
// too noisy to price against. A healthy single-model/single-year cohort sits well
// under 0.5; a contaminated one blows past it.
export const MAX_DISPERSION = { color: 0.45, year: 0.55, yearBand: 0.65, model: 0.8 }

const asc = (a, b) => a - b
const finite = values => values.filter(v => Number.isFinite(v) && v > 0)

export function percentile(sortedValues, p) {
  if (!sortedValues.length) return 0
  const index = (sortedValues.length - 1) * p
  const low = Math.floor(index), high = Math.ceil(index)
  if (low === high) return sortedValues[low]
  return sortedValues[low] + (sortedValues[high] - sortedValues[low]) * (index - low)
}

export function median(values) {
  const sorted = finite(values).slice().sort(asc)
  return sorted.length ? percentile(sorted, 0.5) : 0
}

export function mean(values) {
  const list = finite(values)
  return list.length ? list.reduce((sum, v) => sum + v, 0) / list.length : 0
}

/**
 * Tukey fence outlier removal. Unlike the old fixed 0.45–1.6 band this adapts to the
 * cohort's own spread, and it never removes more than 25% of the sample — if more
 * than a quarter of the data looks "extreme", the cohort itself is wrong and the
 * caller should reject it rather than sculpt it into a pretty number.
 */
export function robustTrim(values, { factor = 1.5 } = {}) {
  const sorted = finite(values).slice().sort(asc)
  if (sorted.length < 4) return { kept: sorted, removed: 0, suspectCohort: sorted.length < 4 }
  const q1 = percentile(sorted, 0.25), q3 = percentile(sorted, 0.75), iqr = q3 - q1
  const low = q1 - factor * iqr, high = q3 + factor * iqr
  const kept = sorted.filter(v => v >= low && v <= high)
  const removed = sorted.length - kept.length
  if (!kept.length) return { kept: sorted, removed: 0, suspectCohort: true }
  return { kept, removed, suspectCohort: removed / sorted.length > 0.25 }
}

export function describe(values) {
  const { kept, removed, suspectCohort } = robustTrim(values)
  const sorted = kept.slice().sort(asc)
  const med = percentile(sorted, 0.5)
  const q1 = percentile(sorted, 0.25), q3 = percentile(sorted, 0.75)
  const absDev = sorted.map(v => Math.abs(v - med)).sort(asc)
  return {
    samples: sorted.length,
    trimmed: removed,
    suspectCohort,
    avg: Math.round(mean(sorted)),
    median: Math.round(med),
    p25: Math.round(q1),
    p75: Math.round(q3),
    min: sorted.length ? Math.round(sorted[0]) : 0,
    max: sorted.length ? Math.round(sorted[sorted.length - 1]) : 0,
    mad: Math.round(percentile(absDev, 0.5)),
    dispersion: med ? Number(((q3 - q1) / med).toFixed(3)) : 0,
  }
}

const dayMs = 86400000
function withinWindow(item, cutoff) {
  if (!cutoff) return true
  const stamp = Date.parse(item.lastSeenAt || item.last_seen_at || item.updatedAt || item.firstSeenAt || '')
  // Items with no usable timestamp are kept — dropping them would empty a fresh DB.
  return Number.isFinite(stamp) ? stamp >= cutoff : true
}

/**
 * Build the rolling price index.
 * Returns a Map keyed by vehicle identity, each holding per-year and per-year+colour
 * price lists plus the identity metadata needed to explain a valuation to the user.
 */
export function buildPriceIndex(listings, { categoryHint = 'light', windowDays = DEFAULT_WINDOW_DAYS, now = Date.now(), reference = null, screen = true } = {}) {
  const cutoff = windowDays > 0 ? now - windowDays * dayMs : 0
  const eligible = []
  let skippedStale = 0, skippedUnpriced = 0, skippedVague = 0

  // ---- pass 0: structural eligibility ------------------------------------
  for (const item of listings || []) {
    const price = Number(item.price) || 0
    if (price <= 0) { skippedUnpriced += 1; continue }
    if (!withinWindow(item, cutoff)) { skippedStale += 1; continue }
    const identity = item.identity || identifyVehicle(item.title, categoryHint)
    // A listing whose brand we cannot read contributes nothing trustworthy to a
    // cohort — including it is exactly how «مینی بوس» became one giant bucket.
    if (!identity.confident) { skippedVague += 1; continue }
    eligible.push({ ...item, identity, price, year: normalizeYear(item.year) || 0, color: baseColor(item.color) })
  }

  const assemble = rows => {
    const index = new Map()
    for (const item of rows) {
      if (!index.has(item.identity.key)) index.set(item.identity.key, { identity: item.identity, prices: [], years: new Map() })
      const entry = index.get(item.identity.key)
      entry.prices.push(item.price)
      if (item.year) {
        if (!entry.years.has(item.year)) entry.years.set(item.year, { year: item.year, prices: [], colors: new Map() })
        const bucket = entry.years.get(item.year)
        bucket.prices.push(item.price)
        if (item.color) {
          if (!bucket.colors.has(item.color)) bucket.colors.set(item.color, [])
          bucket.colors.get(item.color).push(item.price)
        }
      }
    }
    return index
  }

  if (!screen) {
    const index = assemble(eligible)
    return { index, windowDays, generatedAt: new Date(now).toISOString(), verdicts: new Map(), stats: { considered: eligible.length, skippedStale, skippedUnpriced, skippedVague, rejected: 0, review: 0 } }
  }

  // ---- pass 1: provisional cohort stats, used only as a fraud yardstick ----
  // Built WITHOUT screening so we have something to compare against; it is never
  // published. Fake ads distort it, which is why the reference index outranks it.
  const provisional = assemble(eligible)
  const provisionalStats = new Map()
  for (const [key, entry] of provisional) provisionalStats.set(key, describe(entry.prices))

  // ---- pass 2: screen every listing, then rebuild from the clean population --
  const verdicts = new Map()
  const clean = []
  let rejected = 0, review = 0
  for (const item of eligible) {
    const verdict = screenListing(item, { reference, cohort: provisionalStats.get(item.identity.key) || null })
    verdicts.set(item.id ?? item.token, verdict)
    if (verdict.severity === 'reject') { rejected += 1; continue }
    if (verdict.severity === 'review') { review += 1; continue }
    clean.push(item)
  }

  const index = assemble(clean)
  return {
    index,
    windowDays,
    generatedAt: new Date(now).toISOString(),
    verdicts,
    stats: { considered: clean.length, skippedStale, skippedUnpriced, skippedVague, rejected, review, screened: eligible.length },
  }
}

const LEVEL_LABELS = {
  color: 'همان مدل، سال و رنگ',
  year: 'همان مدل و همان سال',
  yearBand: 'همان مدل، سال نزدیک (±۱)',
  model: 'همان مدل (همهٔ سال‌ها)',
}

function acceptCohort(level, values) {
  const stats = describe(values)
  if (stats.samples < MIN_SAMPLES[level]) return null
  if (stats.suspectCohort) return null
  if (stats.dispersion > MAX_DISPERSION[level]) return null
  return { level, label: LEVEL_LABELS[level], ...stats }
}

/**
 * Value a single listing against the index.
 * Walks from the most specific cohort to the least and returns the FIRST one that
 * passes the sample-size, contamination and dispersion gates. Returns null when no
 * level qualifies — the caller must then show "داده کافی نیست", never a guess.
 */
export function valuate(item, built, { categoryHint = 'light' } = {}) {
  const index = built?.index || built
  if (!index) return null
  const identity = item.identity || identifyVehicle(item.title, categoryHint)
  if (!identity.confident) return null
  const entry = index.get(identity.key)
  if (!entry) return null

  const year = normalizeYear(item.year) || 0
  const color = baseColor(item.color)

  if (year && color) {
    const bucket = entry.years.get(year)
    const accepted = bucket && acceptCohort('color', bucket.colors.get(color) || [])
    if (accepted) return { ...accepted, identity }
  }
  if (year) {
    const bucket = entry.years.get(year)
    const accepted = bucket && acceptCohort('year', bucket.prices)
    if (accepted) return { ...accepted, identity }
  }
  if (year) {
    // Same model, adjacent build years — far safer than collapsing every year.
    const band = []
    for (const offset of [-1, 0, 1]) { const bucket = entry.years.get(year + offset); if (bucket) band.push(...bucket.prices) }
    const accepted = acceptCohort('yearBand', band)
    if (accepted) return { ...accepted, identity }
  }
  // Whole-model fallback is only allowed when the model's price spread is tight,
  // which in practice means a model whose value barely depends on build year.
  const accepted = acceptCohort('model', entry.prices)
  return accepted ? { ...accepted, identity } : null
}

/** Flat, serialisable view of the index — this is what gets persisted as the baseline. */
export function exportBaseline(built, { category = 'light', minSamples = 4 } = {}) {
  const rows = []
  for (const [key, entry] of built.index) {
    const modelStats = describe(entry.prices)
    if (modelStats.samples >= minSamples) {
      rows.push({ category, cohortKey: key, segment: entry.identity.segment, type: entry.identity.type, brand: entry.identity.brand, model: entry.identity.model, label: entry.identity.label, year: 0, color: '', ...modelStats })
    }
    for (const [year, bucket] of entry.years) {
      const yearStats = describe(bucket.prices)
      if (yearStats.samples >= minSamples) {
        rows.push({ category, cohortKey: key, segment: entry.identity.segment, type: entry.identity.type, brand: entry.identity.brand, model: entry.identity.model, label: entry.identity.label, year, color: '', ...yearStats })
      }
      for (const [color, prices] of bucket.colors) {
        const colorStats = describe(prices)
        if (colorStats.samples >= minSamples) {
          rows.push({ category, cohortKey: key, segment: entry.identity.segment, type: entry.identity.type, brand: entry.identity.brand, model: entry.identity.model, label: entry.identity.label, year, color, ...colorStats })
        }
      }
    }
  }
  rows.sort((a, b) => b.samples - a.samples)
  return { generatedAt: built.generatedAt, windowDays: built.windowDays, category, rows }
}

/** Human-readable market summary (the /api/market/models payload). */
export function summarizeIndex(built, { minSamples = MIN_SAMPLES.model } = {}) {
  const models = []
  for (const [key, entry] of built.index) {
    const stats = describe(entry.prices)
    if (stats.samples < minSamples) continue
    const byYear = [...entry.years.values()]
      .map(bucket => {
        const yearStats = describe(bucket.prices)
        if (yearStats.samples < MIN_SAMPLES.year) return null
        const byColor = [...bucket.colors.entries()]
          .map(([color, prices]) => { const s = describe(prices); return s.samples >= MIN_SAMPLES.color ? { color, ...s } : null })
          .filter(Boolean).sort((a, b) => b.samples - a.samples)
        return { year: bucket.year, ...yearStats, byColor }
      })
      .filter(Boolean).sort((a, b) => b.year - a.year)
    models.push({ cohortKey: key, model: entry.identity.label, segment: entry.identity.segment, type: entry.identity.type, brand: entry.identity.brand, ...stats, byYear })
  }
  models.sort((a, b) => b.samples - a.samples)
  return { models, totalModels: models.length, generatedAt: built.generatedAt, windowDays: built.windowDays, coverage: built.stats }
}
