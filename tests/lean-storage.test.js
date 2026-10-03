import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { baselineIndex, buildPriceIndex, exportBaseline, valuate } from '../src/server/pricing.js'
import { analyzeListings } from '../src/server/analyzer.js'
import { createDatabase } from '../src/server/database.js'

// A population big enough to clear the cohort sample gates.
const population = () => {
  const items = []
  for (let i = 0; i < 40; i++) {
    items.push({
      id: `p${i}`, title: 'پژو ۲۰۷ اتوماتیک', year: 1402, color: 'سفید',
      price: 950_000_000 + (i % 8) * 10_000_000, image: 'x', city: 'تهران',
      lastSeenAt: new Date().toISOString(),
    })
  }
  return items
}

describe('scoring from persisted averages (lean storage)', () => {
  it('values a listing from baseline rows the same way it would from raw ads', () => {
    const raw = population()
    const built = buildPriceIndex(raw, { categoryHint: 'light' })
    const subject = { title: 'پژو ۲۰۷ اتوماتیک', year: 1402, color: 'سفید', price: 800_000_000 }

    const fromRaw = valuate(subject, built, { categoryHint: 'light' })
    const fromBaseline = valuate(subject, baselineIndex(exportBaseline(built, { category: 'light' }).rows), { categoryHint: 'light' })

    expect(fromRaw).toBeTruthy()
    expect(fromBaseline).toBeTruthy()
    // Same cohort, same central value — the aggregate carries the verdict.
    expect(fromBaseline.median).toBe(fromRaw.median)
    expect(fromBaseline.samples).toBe(fromRaw.samples)
  })

  it('round-trips through SQLite so a restart keeps the knowledge', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'khodroto-lean-'))
    const store = createDatabase(path.join(dir, 'test.db'))
    try {
      const built = buildPriceIndex(population(), { categoryHint: 'light' })
      store.replaceBaseline('light', exportBaseline(built, { category: 'light' }).rows, { windowDays: 30 })

      // Nothing else is stored: no ads at all.
      expect(store.db.prepare('SELECT COUNT(*) n FROM listings').get().n).toBe(0)

      const index = baselineIndex(store.baselineRows('light', 10000))
      const analysis = analyzeListings(
        [{ id: 'live-1', title: 'پژو ۲۰۷ اتوماتیک', year: 1402, color: 'سفید', price: 800_000_000, image: 'x' }],
        { category: 'light', includeNoPhoto: true, priceIndex: index },
      )
      const [scored] = analysis.items
      expect(scored.market).toBeGreaterThan(0)
      expect(scored.discount).toBeGreaterThan(0)
    } finally { store.db.close(); fs.rmSync(dir, { recursive: true, force: true }) }
  })

  it('refuses to invent a price when no cohort qualifies', () => {
    const index = baselineIndex([{ cohort_key: 'other-model', year: 1402, color: '', samples: 50, avg: 1e9, median: 1e9, p25: 9e8, p75: 11e8, dispersion: 0.1 }])
    expect(valuate({ title: 'پژو ۲۰۷ اتوماتیک', year: 1402, price: 8e8 }, index, { categoryHint: 'light' })).toBeNull()
  })

  it('rejects a cohort with too few samples instead of guessing', () => {
    const built = buildPriceIndex(population(), { categoryHint: 'light' })
    const rows = exportBaseline(built, { category: 'light' }).rows.map(row => ({ ...row, samples: 2 }))
    expect(valuate({ title: 'پژو ۲۰۷ اتوماتیک', year: 1402, color: 'سفید', price: 8e8 }, baselineIndex(rows), { categoryHint: 'light' })).toBeNull()
  })

  it('records observations at ~40 bytes instead of storing the ad', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'khodroto-lean-'))
    const store = createDatabase(path.join(dir, 'test.db'))
    try {
      store.recordObservations(['a', 'b', 'c', 'a'], 'light')
      expect(store.db.prepare('SELECT COUNT(*) n FROM listing_observations').get().n).toBe(3)
      expect(store.db.prepare('SELECT COUNT(*) n FROM listings').get().n).toBe(0)
      expect(store.publicStats().analyzedToday).toBe(3)
    } finally { store.db.close(); fs.rmSync(dir, { recursive: true, force: true }) }
  })

  it('reports swept counters when no ads are kept on disk', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'khodroto-lean-'))
    const store = createDatabase(path.join(dir, 'test.db'))
    try {
      store.recordSweepStats({ total: 18_400, golden: 37, active: 18_400 })
      const stats = store.publicStats()
      expect(stats.totalListings).toBe(18_400)
      expect(stats.goldenOpportunities).toBe(37)
    } finally { store.db.close(); fs.rmSync(dir, { recursive: true, force: true }) }
  })
})
