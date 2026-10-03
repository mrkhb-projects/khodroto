// Reference-price registry.
//
// Collects daily market valuations from Iranian price authorities, maps each row
// onto the platform's own vehicle identity, and exposes the lookups the fraud
// screen and the pricing engine need:
//
//   priceFor(cohortKey, year) → what this exact car/year is really worth today
//   floorFor(cohortKey)       → the cheapest this model has ever been valued at
//
// Sources are independent of Divar on purpose: if every seller on Divar posts a
// fantasy price, the reference still tells the truth.

import { identifyVehicle, normalizeYear } from '../vehicle-identity.js'
import { bazarkhodroPrices } from './bazarkhodro.js'
import { hamrahMechanicPrices } from './hamrah-mechanic.js'
import { normaliseCurrency, plausiblePrice } from './common.js'
import { scrapeSource } from './generic.js'
import declarative from './sources.json' with { type: 'json' }

// Hand-written sources (shapes too specific for the generic parser).
const SOURCES = {
  bazarkhodro: { name: 'بازارخودرو', kind: 'new', segment: 'light', categoryHint: 'light', run: bazarkhodroPrices, enabled: () => process.env.REF_BAZARKHODRO_ENABLED !== 'false' },
  'hamrah-mechanic': { name: 'همراه مکانیک', kind: 'used', segment: 'light', categoryHint: 'light', run: hamrahMechanicPrices, enabled: () => process.env.REF_HAMRAH_ENABLED !== 'false' },
}

// Declarative sources from sources.json — these cover the segments that had NO
// reference data at all: heavy vehicles and motorcycles.
for (const entry of declarative.sources || []) {
  SOURCES[entry.key] = {
    name: entry.name,
    kind: entry.kind || 'used',
    segment: entry.segment || 'light',
    categoryHint: entry.categoryHint || 'light',
    about: entry.about || '',
    declarative: true,
    run: () => scrapeSource(entry),
    enabled: () => process.env[entry.enabledEnv || ''] !== 'false',
  }
}

export const sourceCatalogue = () => Object.entries(SOURCES).map(([key, source]) => ({
  key, name: source.name, segment: source.segment, kind: source.kind, declarative: Boolean(source.declarative), about: source.about || '',
}))

const lastStatus = new Map()

/** Attach our canonical cohort key to a raw reference row. */
export function identifyRow(row) {
  const title = [row.brand, row.model, row.trim].filter(Boolean).join(' ')
  // The category hint matters: «کشنده ولوو FH» must resolve in the heavy taxonomy,
  // never against passenger-car Volvos.
  const identity = identifyVehicle(title, row.categoryHint || 'light')
  const year = normalizeYear(row.year) || 0
  const price = normaliseCurrency(Number(row.price) || 0)
  if (!identity.confident || !plausiblePrice(price) || !year) return null
  return { ...row, price, year, cohortKey: identity.key, label: identity.label, segment: identity.segment }
}

/** Fetch every enabled source. Each failure is isolated. */
export async function collectReferencePrices({ sources = Object.keys(SOURCES) } = {}) {
  const rows = []
  const report = []
  for (const key of sources) {
    const source = SOURCES[key]
    if (!source || !source.enabled()) continue
    const started = Date.now()
    try {
      const result = await source.run()
      const mapped = (result.rows || [])
        .map(row => identifyRow({ ...row, source: key, categoryHint: row.categoryHint || source.categoryHint }))
        .filter(Boolean)
      rows.push(...mapped)
      const status = { key, name: source.name, segment: source.segment, kind: source.kind, ok: mapped.length > 0, raw: result.rows?.length || 0, rows: mapped.length, note: result.note || '', ms: Date.now() - started, lastRun: new Date().toISOString() }
      lastStatus.set(key, status)
      report.push(status)
    } catch (error) {
      const status = { key, name: source.name, segment: source.segment, kind: source.kind, ok: false, raw: 0, rows: 0, note: error.message, ms: Date.now() - started, lastRun: new Date().toISOString() }
      lastStatus.set(key, status)
      report.push(status)
    }
  }
  return { rows, report, fetchedAt: new Date().toISOString() }
}

export const referenceStatuses = () => [...lastStatus.values()]

/**
 * Build the in-memory lookup used during scoring.
 * `rows` may come straight from collectReferencePrices() or from the DB cache.
 */
export function buildReferenceIndex(rows = []) {
  const byCohortYear = new Map()   // `${cohortKey}|${year}` → {price, sources}
  const byCohort = new Map()       // cohortKey → {min, max, years:Map, label}

  for (const row of rows) {
    const cohortKey = row.cohortKey || row.cohort_key
    const year = Number(row.year) || 0
    const price = Number(row.price) || 0
    if (!cohortKey || !year || !plausiblePrice(price)) continue

    const slot = `${cohortKey}|${year}`
    const existing = byCohortYear.get(slot)
    // Several sources may price the same car; keep the median-ish middle by
    // averaging, which also smooths a single mis-parsed row.
    if (existing) {
      existing.samples += 1
      existing.price = Math.round((existing.price * (existing.samples - 1) + price) / existing.samples)
      existing.sources.add(row.source || 'unknown')
    } else {
      byCohortYear.set(slot, { cohortKey, year, price, samples: 1, sources: new Set([row.source || 'unknown']), label: row.label || '' })
    }

    if (!byCohort.has(cohortKey)) byCohort.set(cohortKey, { cohortKey, label: row.label || '', min: price, max: price, years: new Map() })
    const cohort = byCohort.get(cohortKey)
    cohort.min = Math.min(cohort.min, price)
    cohort.max = Math.max(cohort.max, price)
    cohort.years.set(year, byCohortYear.get(slot).price)
  }

  return {
    size: byCohortYear.size,
    cohorts: byCohort.size,

    /** Reference value for an exact model+year, or the nearest year within ±2. */
    priceFor(cohortKey, year) {
      const target = normalizeYear(year) || 0
      if (!cohortKey) return null
      if (target) {
        const exact = byCohortYear.get(`${cohortKey}|${target}`)
        if (exact) return { price: exact.price, year: target, exact: true, sources: [...exact.sources] }
        for (const offset of [1, -1, 2, -2]) {
          const near = byCohortYear.get(`${cohortKey}|${target + offset}`)
          if (near) return { price: near.price, year: target + offset, exact: false, sources: [...near.sources] }
        }
      }
      return null
    },

    /** Cheapest published valuation across every build year of this model. */
    floorFor(cohortKey) {
      const cohort = byCohort.get(cohortKey)
      return cohort ? cohort.min : null
    },

    ceilingFor(cohortKey) {
      const cohort = byCohort.get(cohortKey)
      return cohort ? cohort.max : null
    },

    has: cohortKey => byCohort.has(cohortKey),
    cohortList: () => [...byCohort.values()].map(({ cohortKey, label, min, max, years }) => ({ cohortKey, label, min, max, years: years.size })),
  }
}

export const EMPTY_REFERENCE = buildReferenceIndex([])
