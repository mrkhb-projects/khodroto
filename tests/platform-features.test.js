import { describe, expect, it } from 'vitest'
import { extractSellerIdentity } from '../src/server/divar.js'
import { estimateValue } from '../src/server/estimate.js'
import { buildPriceIndex } from '../src/server/pricing.js'
import { createDatabase } from '../src/server/database.js'

describe('seller identity extraction', () => {
  // Reputation was recorded against item.sellerKey, but nothing ever produced it.
  // Divar has shipped the shop reference in several shapes, hence the deep scan.
  it('finds a flat business reference', () => {
    expect(extractSellerIdentity({ sections: [{ widgets: [{ data: { business_ref: 'auto-kian' } }] }] }))
      .toMatchObject({ key: 'divar-business:auto-kian' })
  })

  it('finds a nested business object and prefers its slug', () => {
    const detail = { sections: [{ widgets: [{ data: { business_data: { slug: 'gallery-7', name: 'گالری هفت' } } }] }] }
    expect(extractSellerIdentity(detail)).toEqual({ key: 'divar-business:gallery-7', name: 'گالری هفت' })
  })

  it('falls back to the shop name when no id is published', () => {
    expect(extractSellerIdentity({ shop_name: 'نمایشگاه پارس' }))
      .toEqual({ key: 'divar-business:نمایشگاه پارس', name: 'نمایشگاه پارس' })
  })

  it('returns null for a private seller, which must stay the common case', () => {
    expect(extractSellerIdentity({ sections: [{ widgets: [{ data: { title: 'کارکرد', value: '۱۲۰٬۰۰۰' } }] }] })).toBeNull()
    expect(extractSellerIdentity(null)).toBeNull()
  })

  it('does not recurse forever on a self-referencing payload', () => {
    const detail = { sections: [] }
    detail.self = detail
    expect(() => extractSellerIdentity(detail)).not.toThrow()
  })
})

describe('seller identity survives the detail cache', () => {
  it('round-trips through listing_details, including an older schema', () => {
    const store = createDatabase(':memory:')
    store.detailCache.set('tok1', { color: 'سفید', km: 42000, year: 1400, sellerKey: 'divar-business:x', sellerName: 'گالری ایکس' })
    expect(store.detailCache.get('tok1')).toMatchObject({ km: 42000, sellerKey: 'divar-business:x', sellerName: 'گالری ایکس' })
    // A listing cached before this feature existed must still read back cleanly.
    store.db.prepare("INSERT OR REPLACE INTO listing_details(token,color,km,year,fetched_at) VALUES('old','مشکی',1000,1399,'2026-01-01')").run()
    expect(store.detailCache.get('old')).toMatchObject({ sellerKey: '', sellerName: '' })
  })
})

describe('alert storage', () => {
  const seed = () => {
    const store = createDatabase(':memory:')
    store.db.prepare("INSERT INTO users(phone,name,role,created_at) VALUES('09120000000','تست','user','2026-01-01')").run()
    return store
  }

  it('creates, lists, toggles and deletes an alert', () => {
    const store = seed()
    store.createAlert(1, { title: 'پژو ۲۰۷', filters: { category: 'light', maxPrice: 1_000_000_000 } })
    let items = store.alerts(1)
    expect(items).toHaveLength(1)
    expect(JSON.parse(items[0].filters)).toMatchObject({ maxPrice: 1_000_000_000 })

    store.toggleAlert(1, items[0].id, false)
    expect(store.alerts(1)[0].enabled).toBe(0)

    expect(store.deleteAlert(1, items[0].id)).toBe(true)
    expect(store.alerts(1)).toHaveLength(0)
  })

  it('refuses to delete another user\'s alert', () => {
    const store = seed()
    store.db.prepare("INSERT INTO users(phone,name,role,created_at) VALUES('09120000001','دیگری','user','2026-01-01')").run()
    store.createAlert(1, { title: 'مال من', filters: {} })
    const id = store.alerts(1)[0].id
    expect(store.deleteAlert(2, id)).toBe(false)
    expect(store.alerts(1)).toHaveLength(1)
  })

  it('counts alerts per user so the API can enforce a limit', () => {
    const store = seed()
    for (let i = 0; i < 3; i++) store.createAlert(1, { title: `a${i}`, filters: {} })
    expect(store.countAlerts(1)).toBe(3)
    expect(store.countAlerts(2)).toBe(0)
  })
})

describe('value estimate', () => {
  const M = 1e6
  const index = () => buildPriceIndex(
    [920, 940, 950, 960, 970, 935, 955, 965, 945, 975, 930, 958].map((price, i) => ({
      id: `e${i}`, token: `e${i}`, title: 'پژو ۲۰۷ اتوماتیک مدل ۱۴۰۱', price: price * M,
      year: 1401, color: 'سفید', image: 'i.jpg',
    })),
    { categoryHint: 'light' },
  )

  it('values a car the user describes and shows its working', () => {
    const result = estimateValue({ title: 'پژو ۲۰۷ اتوماتیک', year: 1401, km: 60000, color: 'سفید' }, { priceIndex: index() })
    expect(result.ok).toBe(true)
    expect(result.estimate).toBeGreaterThan(800 * M)
    expect(result.range.low).toBeLessThan(result.estimate)
    expect(result.range.high).toBeGreaterThan(result.estimate)
    expect(result.sources.length).toBeGreaterThan(0)
  })

  it('widens the range and says so when mileage is unknown', () => {
    const known = estimateValue({ title: 'پژو ۲۰۷ اتوماتیک', year: 1401, km: 60000 }, { priceIndex: index() })
    const unknown = estimateValue({ title: 'پژو ۲۰۷ اتوماتیک', year: 1401 }, { priceIndex: index() })
    const width = r => r.range.high - r.range.low
    expect(width(unknown)).toBeGreaterThan(width(known))
    expect(unknown.adjustments.note).toBeTruthy()
  })

  it('prices a damaged car below a clean one', () => {
    const clean = estimateValue({ title: 'پژو ۲۰۷ اتوماتیک', year: 1401, km: 60000, body: 'بدون رنگ' }, { priceIndex: index() })
    const crashed = estimateValue({ title: 'پژو ۲۰۷ اتوماتیک', year: 1401, km: 60000, body: 'تصادفی' }, { priceIndex: index() })
    expect(crashed.estimate).toBeLessThan(clean.estimate)
  })

  it('refuses to invent a price for an unknown model', () => {
    const result = estimateValue({ title: 'یک چیز ناشناخته', year: 1401 }, { priceIndex: index() })
    expect(result.ok).toBe(false)
    expect(result.message).toBeTruthy()
  })
})
