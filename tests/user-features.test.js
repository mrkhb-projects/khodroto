import { describe, expect, it, beforeEach } from 'vitest'
import { createDatabase } from '../src/server/database.js'

const M = 1e6
let store

function seed() {
  const db = createDatabase(':memory:')
  db.db.prepare("INSERT INTO users(phone,name,role,created_at) VALUES('09120000001','کاربر','user',datetime('now'))").run()
  db.db.prepare("INSERT INTO users(phone,name,role,created_at) VALUES('09120000002','دیگری','user',datetime('now'))").run()
  db.db.prepare("INSERT INTO alerts(user_id,title,filters,created_at) VALUES(1,'پژو ۲۰۷','{}',datetime('now'))").run()
  return db
}
beforeEach(() => { store = seed() })

describe('saved listings live in the account', () => {
  it('keeps the payload so the card still renders after the ad disappears', () => {
    store.saveListing(1, 'tok1', { title: 'پژو ۲۰۷', price: 900 * M, city: 'تهران' })
    const [item] = store.savedListings(1)
    expect(item).toMatchObject({ token: 'tok1', id: 'tok1', title: 'پژو ۲۰۷', price: 900 * M })
  })

  it('updates in place rather than duplicating', () => {
    store.saveListing(1, 'tok1', { title: 'قدیمی', price: 900 * M })
    store.saveListing(1, 'tok1', { title: 'تازه', price: 880 * M })
    expect(store.savedListings(1)).toHaveLength(1)
    expect(store.savedListings(1)[0].title).toBe('تازه')
  })

  it('preserves the original save time when the payload is refreshed', () => {
    store.db.prepare("INSERT INTO saved_listings(user_id,token,payload,created_at) VALUES(1,'tok1','{}','2026-01-01T00:00:00.000Z')").run()
    store.saveListing(1, 'tok1', { title: 'به‌روز' })
    expect(store.savedListings(1)[0].savedAt).toBe('2026-01-01T00:00:00.000Z')
  })

  it('keeps one user\u2019s list out of another\u2019s', () => {
    store.saveListing(1, 'tok1', {})
    store.saveListing(2, 'tok2', {})
    expect(store.savedTokens(1)).toEqual(['tok1'])
    expect(store.savedTokens(2)).toEqual(['tok2'])
    expect(store.unsaveListing(2, 'tok1')).toBe(false)
  })

  it('removes cleanly', () => {
    store.saveListing(1, 'tok1', {})
    expect(store.unsaveListing(1, 'tok1')).toBe(true)
    expect(store.savedListings(1)).toHaveLength(0)
  })

  it('survives a corrupt payload instead of throwing', () => {
    store.db.prepare("INSERT INTO saved_listings(user_id,token,payload,created_at) VALUES(1,'bad','{not json','2026-01-01')").run()
    expect(() => store.savedListings(1)).not.toThrow()
    expect(store.savedListings(1)[0].token).toBe('bad')
  })
})

describe('in-app notifications', () => {
  const deliver = (listingId, message) => store.recordAlertDelivery(1, 1, listingId, message, 'queued')

  it('shows a matched opportunity even when no SMS went out', () => {
    deliver('l1', 'فرصت تازه پیدا شد')
    const items = store.notifications(1)
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ message: 'فرصت تازه پیدا شد', status: 'queued', title: 'پژو ۲۰۷' })
  })

  it('counts unread and clears them', () => {
    deliver('l1', 'یک')
    deliver('l2', 'دو')
    expect(store.unreadNotifications(1)).toBe(2)
    expect(store.markNotificationsRead(1)).toBe(2)
    expect(store.unreadNotifications(1)).toBe(0)
  })

  it('can clear a single notification', () => {
    deliver('l1', 'یک')
    deliver('l2', 'دو')
    const [newest] = store.notifications(1)
    store.markNotificationsRead(1, [newest.id])
    expect(store.unreadNotifications(1)).toBe(1)
  })

  it('does not leak another user\u2019s notifications', () => {
    deliver('l1', 'مال کاربر یک')
    expect(store.notifications(2)).toHaveLength(0)
    expect(store.unreadNotifications(2)).toBe(0)
  })

  it('marking as read twice is harmless', () => {
    deliver('l1', 'یک')
    store.markNotificationsRead(1)
    expect(store.markNotificationsRead(1)).toBe(0)
  })
})

describe('admin analytics series', () => {
  it('returns one point per day, zero-filled, for every metric', () => {
    const series = store.analyticsSeries(14)
    for (const metric of ['revenue', 'signups', 'analyzed', 'alerts']) {
      expect(series[metric]).toHaveLength(14)
      expect(series[metric].every(point => typeof point.value === 'number')).toBe(true)
    }
    // Gaps must be zeroes, not missing days, or the chart would misread the shape.
    expect(series.signups.at(-1).day).toBe(new Date().toISOString().slice(0, 10))
  })

  it('counts revenue only from active subscriptions', () => {
    const today = new Date().toISOString()
    store.db.prepare("INSERT INTO subscriptions(user_id,plan,status,amount,started_at,created_at) VALUES(1,'pro','active',250000,?,?)").run(today, today)
    store.db.prepare("INSERT INTO subscriptions(user_id,plan,status,amount,started_at,created_at) VALUES(2,'pro','cancelled',999000,?,?)").run(today, today)
    const series = store.analyticsSeries(7)
    expect(series.revenue.at(-1).value).toBe(250000)
  })

  it('tracks signups on the day they happened', () => {
    const series = store.analyticsSeries(7)
    expect(series.signups.at(-1).value).toBe(2)
  })
})
