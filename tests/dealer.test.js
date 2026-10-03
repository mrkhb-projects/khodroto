import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { createDatabase } from '../src/server/database.js'
import { canViewRiskInsights } from '../src/server/access.js'

let store

beforeEach(() => {
  store = createDatabase(':memory:')
  delete process.env.DEV_AUTO_ADMIN
  delete process.env.ADMIN_PHONE
})
afterEach(() => {
  delete process.env.DEV_AUTO_ADMIN
  delete process.env.ADMIN_PHONE
})

const signIn = phone => {
  const code = store.requestOtp(phone)
  return store.verifyOtp(phone, code)
}

describe('OTP sign-in does not hand out admin rights', () => {
  // This read `NODE_ENV !== 'production'`. `npm start` is plain `node server.js`
  // and only app.js sets NODE_ENV, so on any host started the obvious way EVERY
  // person who logged in with a phone number silently became an administrator.
  it('creates an ordinary user even when NODE_ENV is unset', () => {
    const previous = process.env.NODE_ENV
    delete process.env.NODE_ENV
    try {
      expect(signIn('09120000001').user.role).toBe('user')
    } finally { if (previous !== undefined) process.env.NODE_ENV = previous }
  })

  it('creates an ordinary user in development too', () => {
    const previous = process.env.NODE_ENV
    process.env.NODE_ENV = 'development'
    try {
      expect(signIn('09120000002').user.role).toBe('user')
    } finally { process.env.NODE_ENV = previous }
  })

  it('still promotes the configured admin phone', () => {
    process.env.ADMIN_PHONE = '09120000003'
    expect(signIn('09120000003').user.role).toBe('admin')
  })

  it('promotes everyone only when that is asked for explicitly', () => {
    process.env.DEV_AUTO_ADMIN = 'true'
    expect(signIn('09120000004').user.role).toBe('admin')
  })
})

describe('dealer plan entitlements', () => {
  it('includes the analysis the cheaper plan already had', () => {
    // 499,000 against pro's 199,000. Excluding it here meant the dearest plan got
    // no risk insights and, once the result cap became real, the same six results
    // as an anonymous visitor.
    expect(canViewRiskInsights({ role: 'user' }, { status: 'active', plan: 'dealer' })).toBe(true)
  })

  it('does not survive expiry', () => {
    expect(canViewRiskInsights({ role: 'user' }, { status: 'expired', plan: 'dealer' })).toBe(false)
  })

  it('does not leak to the free plan', () => {
    expect(canViewRiskInsights({ role: 'user' }, { status: 'active', plan: 'free' })).toBe(false)
  })
})

describe('dealer inventory and leads', () => {
  const M = 1e6
  beforeEach(() => {
    store.db.prepare("INSERT INTO users(phone,name,role,created_at) VALUES('09121110000','نمایشگاه','user',datetime('now'))").run()
    store.db.prepare("INSERT INTO users(phone,name,role,created_at) VALUES('09121110001','دیگری','user',datetime('now'))").run()
  })

  it('stores a car with what was paid and what is being asked', () => {
    const items = store.saveDealerInventory(1, { title: 'پژو ۲۰۷', brand: 'پژو', year: 1401, buy_price: 880 * M, target_price: 950 * M })
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ title: 'پژو ۲۰۷', buy_price: 880 * M, target_price: 950 * M, status: 'available' })
  })

  it('rejects a status it does not recognise instead of storing it', () => {
    const items = store.saveDealerInventory(1, { title: 'خودرو', status: 'whatever' })
    expect(items[0].status).toBe('available')
  })

  it('keeps one showroom out of another\u2019s stock', () => {
    store.saveDealerInventory(1, { title: 'مال من' })
    expect(store.dealerInventory(2)).toHaveLength(0)
    store.deleteDealerInventory(2, store.dealerInventory(1)[0].id)
    expect(store.dealerInventory(1)).toHaveLength(1)
  })

  it('tracks a lead through its pipeline', () => {
    const created = store.saveDealerLead(1, { name: 'مشتری', phone: '09120001111', vehicle: 'پژو ۲۰۷', budget: 900 * M })
    expect(created[0].status).toBe('new')
    const updated = store.saveDealerLead(1, { name: 'مشتری', status: 'won' }, created[0].id)
    expect(updated[0].status).toBe('won')
  })

  it('keeps leads private to the showroom that owns them', () => {
    store.saveDealerLead(1, { name: 'مشتری من' })
    expect(store.dealerLeads(2)).toHaveLength(0)
  })
})

describe('pricing a showroom\u2019s stock against the market', () => {
  // The dashboard used to show only what the dealer typed in. These are the rules
  // the summary endpoint applies on top of estimateValue.
  const verdictFor = askGap =>
    askGap === null ? 'نامشخص'
      : askGap > 15 ? 'خیلی بالاتر از بازار؛ احتمال ماندن در نمایشگاه'
        : askGap > 8 ? 'بالاتر از بازار؛ فروش کند خواهد بود'
          : askGap < -8 ? 'زیر بازار؛ جا برای افزایش قیمت هست'
            : 'هم‌تراز با بازار'

  const gap = (target, market) => Number((((target - market) / market) * 100).toFixed(1))

  it('calls a car priced at the market exactly that', () => {
    expect(verdictFor(gap(955, 952))).toBe('هم‌تراز با بازار')
  })

  it('warns when the asking price will keep the car on the forecourt', () => {
    expect(verdictFor(gap(1150, 952))).toContain('احتمال ماندن')
  })

  it('points out money left on the table', () => {
    expect(verdictFor(gap(850, 952))).toContain('جا برای افزایش قیمت')
  })

  it('says nothing when the market is unknown', () => {
    expect(verdictFor(null)).toBe('نامشخص')
  })
})
