import { afterEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createDatabase } from '../src/server/database.js'

const opened = []
afterEach(() => {
  for (const entry of opened.splice(0)) {
    entry.store.db.close()
    fs.rmSync(entry.dir, { recursive: true, force: true })
  }
})

function database() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'khodroto-db-'))
  const store = createDatabase(path.join(dir, 'test.db'))
  opened.push({ store, dir })
  return store
}

const item = (id, price = 1_000_000_000) => ({ id, title: `خودرو ${id}`, city: 'تهران', price, market: price, score: 70 })
const row = (store, token) => store.db.prepare('SELECT * FROM listings WHERE token=?').get(token)

describe('listing lifecycle', () => {
  it('keeps observed listings active even when excluded from public analysis', () => {
    const store = database()
    store.storeCrawl({ category: 'light', items: [item('a'), item('photo-less')], observedTokens: ['a', 'photo-less'] }, { category: 'light', reconcile: true })
    store.storeCrawl({ category: 'light', items: [item('a')], observedTokens: ['a', 'photo-less'] }, { category: 'light', reconcile: true })

    expect(row(store, 'photo-less').status).toBe('active')
    expect(row(store, 'photo-less').missing_count).toBe(0)
  })

  it('moves missing listings from stale to inactive after three complete crawls', () => {
    const store = database()
    store.storeCrawl({ category: 'light', items: [item('a'), item('b')], observedTokens: ['a', 'b'] }, { category: 'light', reconcile: true })
    store.storeCrawl({ category: 'light', items: [item('a')], observedTokens: ['a'] }, { category: 'light', reconcile: true })
    expect(row(store, 'b')).toMatchObject({ status: 'stale', missing_count: 1 })
    store.storeCrawl({ category: 'light', items: [item('a')], observedTokens: ['a'] }, { category: 'light', reconcile: true })
    store.storeCrawl({ category: 'light', items: [item('a')], observedTokens: ['a'] }, { category: 'light', reconcile: true })
    expect(row(store, 'b').status).toBe('inactive')
    expect(row(store, 'b').inactive_at).toBeTruthy()
  })

  it('archives confirmed removals and reactivates a listing if it reappears', () => {
    const store = database()
    store.storeCrawl({ category: 'light', items: [item('a')], observedTokens: ['a'] }, { category: 'light', reconcile: true })
    store.storeCrawl({ category: 'light', items: [], observedTokens: [] }, { category: 'light', reconcile: true })
    store.markListingVerification('a', 'removed')
    expect(row(store, 'a').status).toBe('removed')
    expect(row(store, 'a').removed_at).toBeTruthy()

    store.storeCrawl({ category: 'light', items: [item('a', 900_000_000)], observedTokens: ['a'] }, { category: 'light', reconcile: true })
    expect(row(store, 'a')).toMatchObject({ status: 'active', missing_count: 0, removed_at: null, price: 900_000_000 })
  })

  it('does not mark absent listings during a filtered or incomplete crawl', () => {
    const store = database()
    store.storeCrawl({ category: 'light', items: [item('a'), item('b')] }, { category: 'light', reconcile: true })
    store.storeCrawl({ category: 'light', items: [item('a')] }, { category: 'light', reconcile: false })
    expect(row(store, 'b')).toMatchObject({ status: 'active', missing_count: 0 })
  })

  it('reports real daily, total, and golden-opportunity counts', () => {
    const store = database()
    store.storeCrawl({
      category: 'light',
      items: [{ ...item('golden'), score: 91 }],
      observedTokens: ['golden', 'excluded-without-photo'],
    }, { category: 'light', reconcile: true })

    expect(store.publicStats()).toMatchObject({
      analyzedToday: 2,
      totalListings: 1,
      goldenOpportunities: 1,
      activeListings: 1,
    })
  })
})
