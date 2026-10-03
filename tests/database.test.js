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

  it('seeds and manages homepage slides with an audit trail', () => {
    const store = database()
    expect(store.slides(true)).toHaveLength(3)
    store.saveSlide({ title: 'بنر تازه', subtitle: 'متن', image: '/banner.jpg', enabled: true, sort_order: 4 })
    const created = store.slides().find(slide => slide.title === 'بنر تازه')
    expect(created).toMatchObject({ enabled: true, sort_order: 4 })
    store.audit(null, 'create', 'slide', created.id, { title: created.title })
    expect(store.audits()[0]).toMatchObject({ action: 'create', entity: 'slide' })
    store.deleteSlide(created.id)
    expect(store.slides()).toHaveLength(3)
  })

  it('persists managed public settings and subscription plans', () => {
    const store = database()
    expect(store.settings()).toMatchObject({ feature_comparison: 'true', section_faq: 'true', vehicle_brands: expect.stringContaining('ایران خودرو'), backup_schedule: 'daily', notification_master: 'true' })
    store.updateSettings({ section_faq: 'false', hero_title: 'عنوان تازه', about_content: 'الف'.repeat(400), unknown_key: 'ignored' })
    expect(store.settings()).toMatchObject({ section_faq: 'false', hero_title: 'عنوان تازه' })
    expect(store.settings().unknown_key).toBeUndefined()
    expect(store.settings().about_content).toHaveLength(1200)

    expect(store.plans(true).map(plan => plan.id)).toEqual(['free', 'pro', 'dealer'])
    store.savePlan('pro', { name: 'پرو ویژه', price: 250000, description: 'جدید', features: ['تحلیل بازار'], enabled: true, popular: true, sort_order: 2 })
    expect(store.plans().find(plan => plan.id === 'pro')).toMatchObject({ name: 'پرو ویژه', price: 250000, features: ['تحلیل بازار'], enabled: true })
  })

  it('provides persistent dealer inventory and lead management', () => {
    const store = database()
    const user = store.db.prepare("INSERT INTO users(phone,name,created_at) VALUES('09121111111','نمایشگاه تست',datetime('now')) RETURNING id").get()
    store.saveDealerInventory(user.id, { title: 'تارا اتوماتیک', brand: 'ایران خودرو', model: 'تارا', year: 1403, buy_price: 1_000_000_000, target_price: 1_120_000_000, status: 'available' })
    const vehicle = store.dealerInventory(user.id)[0]
    expect(vehicle).toMatchObject({ title: 'تارا اتوماتیک', target_price: 1_120_000_000, status: 'available' })
    store.saveDealerInventory(user.id, { ...vehicle, status: 'sold' }, vehicle.id)
    expect(store.dealerInventory(user.id)[0].status).toBe('sold')

    store.saveDealerLead(user.id, { name: 'خریدار تست', phone: '09120000001', vehicle: 'تارا', budget: 1_200_000_000, status: 'new' })
    const lead = store.dealerLeads(user.id)[0]
    expect(lead).toMatchObject({ name: 'خریدار تست', vehicle: 'تارا', status: 'new' })
    store.deleteDealerLead(user.id, lead.id)
    expect(store.dealerLeads(user.id)).toEqual([])
  })

  it('stores unlimited active payment and SMS integrations without exposing secrets', () => {
    const store = database()
    store.saveIntegration('payment', { name: 'درگاه اصلی', provider: 'zarinpal', secret: 'merchant-secret', enabled: true, priority: 1, config: { merchantId: 'm-1' } })
    store.saveIntegration('payment', { name: 'درگاه پشتیبان', provider: 'idpay', secret: 'backup-secret', enabled: true, priority: 2, config: { merchantId: 'm-2' } })
    store.saveIntegration('sms', { name: 'پیامک تراکنشی', provider: 'kavenegar', secret: 'sms-secret', enabled: true, priority: 1, config: { sender: '1000' } })

    const payments = store.integrations('payment')
    expect(payments).toHaveLength(2)
    expect(payments.every(entry => entry.enabled && entry.hasSecret && !entry.secret && !entry.secret_enc)).toBe(true)
    expect(store.activeIntegrations('payment').map(entry => entry.secret)).toEqual(['merchant-secret', 'backup-secret'])
    expect(store.activeIntegrations('sms')[0].secret).toBe('sms-secret')
    expect(store.stats()).toMatchObject({ paymentGateways: 2, smsProviders: 1 })

    store.saveIntegration('payment', { ...payments[0], secret: '', enabled: false }, payments[0].id)
    expect(store.integrations('payment').filter(entry => entry.enabled)).toHaveLength(1)
    expect(store.activeIntegrations('payment')[0].secret).toBe('backup-secret')
  })
})

describe('listing storage ceiling', () => {
  it('keeps only the freshest listings when the row cap is exceeded', () => {
    const store = database()
    store.storeCrawl({ category: 'light', items: Array.from({ length: 50 }, (_, i) => item(`t${i}`)) }, { category: 'light' })
    // Give every row a distinct last_seen_at so "freshest 30" is unambiguous:
    // t0 is the oldest, t49 the newest.
    const update = store.db.prepare('UPDATE listings SET last_seen_at=? WHERE token=?')
    for (let i = 0; i < 50; i++) update.run(new Date(Date.now() - (50 - i) * 60000).toISOString(), `t${i}`)

    const result = store.trimListings({ maxRows: 30 })

    expect(result.removedByCap).toBe(20)
    expect(result.remaining).toBe(30)
    // The survivors must be the recent ones, not an arbitrary slice.
    expect(row(store, 't49')).toBeTruthy()
    expect(row(store, 't20')).toBeTruthy()
    expect(row(store, 't19')).toBeFalsy()
    expect(row(store, 't0')).toBeFalsy()
  })

  it('drops listings older than the retention window and their dependent rows', () => {
    const store = database()
    store.storeCrawl({ category: 'light', items: [item('fresh'), item('ancient')] }, { category: 'light' })
    store.db.prepare('UPDATE listings SET last_seen_at=? WHERE token=?').run(new Date(Date.now() - 400 * 86400000).toISOString(), 'ancient')

    const result = store.trimListings({ retentionDays: 30 })

    expect(result.removedByAge).toBe(1)
    expect(row(store, 'fresh')).toBeTruthy()
    expect(row(store, 'ancient')).toBeFalsy()
    // price_history/observations for a dropped token must not linger.
    expect(store.db.prepare('SELECT COUNT(*) n FROM price_history WHERE token=?').get('ancient').n).toBe(0)
    expect(store.db.prepare('SELECT COUNT(*) n FROM listing_observations WHERE token=?').get('ancient').n).toBe(0)
  })

  it('never touches saved listings, which keep their own payload copy', () => {
    const store = database()
    store.storeCrawl({ category: 'light', items: [item('kept')] }, { category: 'light' })
    store.db.prepare('INSERT INTO users(phone,created_at) VALUES(?,?)').run('09120000000', new Date().toISOString())
    const user = store.db.prepare('SELECT id FROM users').get()
    store.saveListing(user.id, 'kept', item('kept'))

    store.trimListings({ retentionDays: 0, maxRows: 0 })
    store.db.prepare('DELETE FROM listings').run()

    expect(store.savedListings(user.id)).toHaveLength(1)
  })

  it('does nothing when no ceiling is configured', () => {
    const store = database()
    store.storeCrawl({ category: 'light', items: Array.from({ length: 10 }, (_, i) => item(`n${i}`)) }, { category: 'light' })
    expect(store.trimListings({})).toMatchObject({ removedByAge: 0, removedByCap: 0, remaining: 10 })
  })
})
