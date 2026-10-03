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


describe('admin-managed accounts and subscriptions', () => {
  it('lets an admin edit user identity fields without dropping the role', () => {
    const store = createDatabase(':memory:')
    store.db.prepare("INSERT INTO users(phone,name,role,city,created_at) VALUES('09120000001','قدیمی','user','1','2026-01-01')").run()
    const user = store.updateAdminUser(1, { name: 'نام تازه', city: '2', role: 'admin' })
    expect(user).toMatchObject({ name: 'نام تازه', city: '2', role: 'admin' })
    expect(store.updateAdminUser(404, { name: 'هیچ' })).toBeNull()
  })

  it('lets an admin create users directly from the panel', () => {
    const store = createDatabase(':memory:')
    const user = store.createAdminUser({ phone: '۰۹۱۲۳۴۵۶۷۸۹', name: 'کاربر تازه', city: '1', role: 'admin' })
    expect(user).toMatchObject({ phone: '09123456789', name: 'کاربر تازه', city: '1', role: 'admin' })
    expect(store.adminUsers({ query: '09123456789' }).total).toBe(1)
    expect(store.createAdminUser({ phone: '09123456789', name: 'تکراری' })).toBeNull()
    expect(store.createAdminUser({ phone: '123', name: 'خراب' })).toBeNull()
  })

  it('grants any managed plan to a chosen user and expires the previous active plan', () => {
    const store = createDatabase(':memory:')
    store.db.prepare("INSERT INTO users(phone,name,role,city,created_at) VALUES('09120000001','کاربر','user','1','2026-01-01')").run()
    const first = store.grantSubscription(1, { plan: 'pro', days: 10, amount: 123 })
    expect(first).toMatchObject({ user_id: 1, plan: 'pro', status: 'active', amount: 123 })
    const second = store.grantSubscription(1, { plan: 'dealer', days: 45 })
    expect(second.plan).toBe('dealer')
    const rows = store.adminSubscriptions().filter(row => row.user_id === 1)
    expect(rows.find(row => row.id === first.id).status).toBe('expired')
    expect(rows.find(row => row.id === second.id).status).toBe('active')
  })

  it('adds subscriptions from a phone number and creates the user when needed', () => {
    const store = createDatabase(':memory:')
    const row = store.createAdminSubscription({ phone: '09120000002', name: 'کاربر جدید', plan: 'dealer', status: 'active', days: 5000, amount: 777 })
    expect(row).toMatchObject({ plan: 'dealer', status: 'active', amount: 777 })
    expect(store.userByPhone('09120000002')).toMatchObject({ name: 'کاربر جدید' })
    expect(Date.parse(row.expires_at)).toBeGreaterThan(Date.now() + 4900 * 86400000)
    const pending = store.createAdminSubscription({ phone: '09120000002', plan: 'pro', status: 'pending', days: 30 })
    expect(pending).toMatchObject({ user_id: row.user_id, plan: 'pro', status: 'pending' })
    expect(store.adminSubscriptions().filter(item => item.user_id === row.user_id)).toHaveLength(2)
  })

  it('edits an existing subscription plan, status, amount and expiry', () => {
    const store = createDatabase(':memory:')
    store.db.prepare("INSERT INTO users(phone,name,role,city,created_at) VALUES('09120000001','کاربر','user','1','2026-01-01')").run()
    const row = store.grantSubscription(1, { plan: 'pro', days: 30 })
    const updated = store.updateSubscription(row.id, { plan: 'dealer', status: 'pending', amount: 999, days: 90 })
    expect(updated).toMatchObject({ plan: 'dealer', status: 'pending', amount: 999 })
    expect(Date.parse(updated.expires_at)).toBeGreaterThan(Date.now() + 80 * 86400000)
    expect(store.updateSubscription(9999, { status: 'active' })).toBeNull()
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

describe('shop-style discounts and payment orders', () => {
  it('creates coupon codes, applies them to checkout totals and enforces usage limits', () => {
    const store = createDatabase(':memory:')
    store.saveDiscountCode({ code: 'YALDA30', title: 'کمپین یلدا', percent: 30, max_uses: 1, enabled: true })
    const first = store.applyDiscount('yalda30', 200000, { consume: true })
    expect(first).toMatchObject({ ok: true, code: 'YALDA30', discount: 60000, total: 140000 })
    expect(store.discountCodes()[0].used_count).toBe(1)
    const second = store.applyDiscount('YALDA30', 200000)
    expect(second.ok).toBe(false)
    expect(second.error).toBe('DISCOUNT_LIMIT_REACHED')
  })

  it('records payment orders for the finance panel and lets admin update status', () => {
    const store = createDatabase(':memory:')
    const user = store.createAdminUser({ phone: '09120000003', name: 'خریدار' })
    const sub = store.grantSubscription(user.id, { plan: 'pro', amount: 100000, days: 30 })
    const order = store.recordPaymentOrder({ userId: user.id, subscriptionId: sub.id, plan: 'pro', method: 'sandbox', subtotal: 199000, discount: 99000, amount: 100000, status: 'paid', couponCode: 'VIP' })
    expect(store.adminOrders()[0]).toMatchObject({ id: order.id, phone: '09120000003', amount: 100000, coupon_code: 'VIP' })
    expect(store.updateOrder(order.id, { status: 'refunded', note: 'برگشت وجه دستی' })).toMatchObject({ status: 'refunded', note: 'برگشت وجه دستی' })
  })
})
