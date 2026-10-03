import { describe, expect, it, beforeEach } from 'vitest'
import { createDatabase } from '../src/server/database.js'
import { buildReferenceIndex, MANUAL_SOURCE } from '../src/server/reference/index.js'
import { providerCatalogue, setProviderOverrides } from '../src/server/providers/index.js'

const M = 1e6

describe('admin user directory', () => {
  const seed = () => {
    const store = createDatabase(':memory:')
    const insert = store.db.prepare("INSERT INTO users(phone,name,role,city,created_at) VALUES(?,?,?,?,'2026-01-01')")
    for (let i = 1; i <= 120; i++) insert.run(`0912000${String(i).padStart(4, '0')}`, `کاربر ${i}`, i % 10 === 0 ? 'admin' : 'user', 'تهران')
    return store
  }

  it('pages instead of dumping every row', () => {
    const store = seed()
    const first = store.adminUsers({ limit: 50, offset: 0 })
    expect(first.items).toHaveLength(50)
    expect(first.total).toBe(120)
    const third = store.adminUsers({ limit: 50, offset: 100 })
    expect(third.items).toHaveLength(20)
    expect(third.items[0].id).not.toBe(first.items[0].id)
  })

  it('searches the whole table, not just the first page', () => {
    const store = seed()
    // Previously this filtered client-side over a LIMIT 200 slice, so anyone past
    // the cut simply could not be found.
    const result = store.adminUsers({ query: 'کاربر 117' })
    expect(result.total).toBe(1)
    expect(result.items[0].name).toBe('کاربر 117')
  })

  it('filters by role', () => {
    const store = seed()
    expect(store.adminUsers({ role: 'admin' }).total).toBe(12)
    expect(store.adminUsers({ role: 'user' }).total).toBe(108)
  })

  it('matches on phone number too', () => {
    const store = seed()
    expect(store.adminUsers({ query: '09120000042' }).total).toBe(1)
  })
})

describe('manual reference prices', () => {
  let store
  beforeEach(() => { store = createDatabase(':memory:') })

  it('stores and lists an override', () => {
    store.upsertManualReference({ cohortKey: 'light|سواری|پژو|۲۰۷', year: 1401, price: 950 * M, label: 'پژو ۲۰۷' })
    const rows = store.manualReferences()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ source: 'manual', year: 1401, price: 950 * M })
  })

  it('replaces rather than duplicates on re-entry', () => {
    const row = { cohortKey: 'c1', year: 1400, price: 500 * M }
    store.upsertManualReference(row)
    store.upsertManualReference({ ...row, price: 600 * M })
    expect(store.manualReferences()).toHaveLength(1)
    expect(store.manualReferences()[0].price).toBe(600 * M)
  })

  it('survives an automatic refresh of the scraped sources', () => {
    store.upsertManualReference({ cohortKey: 'c1', year: 1400, price: 500 * M })
    // This is what refreshReferencePrices does for each scraper it runs.
    store.replaceReferencePrices('bazarkhodro', [{ cohortKey: 'c1', year: 1400, price: 420 * M }])
    expect(store.manualReferences()).toHaveLength(1)
  })

  it('can be removed again', () => {
    store.upsertManualReference({ cohortKey: 'c1', year: 1400, price: 500 * M })
    expect(store.deleteManualReference('c1', 1400)).toBe(true)
    expect(store.manualReferences()).toHaveLength(0)
    expect(store.deleteManualReference('c1', 1400)).toBe(false)
  })
})

describe('manual override beats the scrapers', () => {
  const rows = (manualPrice, scraped = [420 * M, 430 * M]) => [
    ...scraped.map((price, index) => ({ source: `site${index}`, cohortKey: 'c1', year: 1400, price, label: 'خودرو' })),
    ...(manualPrice ? [{ source: MANUAL_SOURCE, cohortKey: 'c1', year: 1400, price: manualPrice, label: 'خودرو' }] : []),
  ]

  it('averages scraped sources when there is no override', () => {
    const index = buildReferenceIndex(rows(0))
    expect(index.priceFor('c1', 1400).price).toBe(425 * M)
  })

  it('takes the typed-in price verbatim, not an average with the bad data', () => {
    // The point of the override is to correct a source that has started parsing
    // garbage; averaging it back in would defeat the purpose.
    const index = buildReferenceIndex(rows(900 * M))
    expect(index.priceFor('c1', 1400).price).toBe(900 * M)
  })

  it('wins regardless of the order rows arrive in', () => {
    const reversed = [...rows(900 * M)].reverse()
    expect(buildReferenceIndex(reversed).priceFor('c1', 1400).price).toBe(900 * M)
  })
})

describe('source toggles', () => {
  it('are off by default', () => {
    setProviderOverrides({})
    expect(providerCatalogue().every(provider => !provider.enabled)).toBe(true)
  })

  it('can be switched on from the panel without an environment variable', () => {
    setProviderOverrides({ BAMA_ENABLED: 'true' })
    const bama = providerCatalogue().find(provider => provider.key === 'bama')
    expect(bama.enabled).toBe(true)
    expect(bama.envKey).toBe('BAMA_ENABLED')
  })

  it('can force a source off even when the host sets the variable', () => {
    process.env.RING_ENABLED = 'true'
    setProviderOverrides({ RING_ENABLED: 'false' })
    expect(providerCatalogue().find(provider => provider.key === 'ring').enabled).toBe(false)
    setProviderOverrides({})
    expect(providerCatalogue().find(provider => provider.key === 'ring').enabled).toBe(true)
    delete process.env.RING_ENABLED
    setProviderOverrides({})
  })
})
