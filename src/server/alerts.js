// Alert dispatcher.
//
// The `alerts` table and the "ساخت هشدار" button already existed, but nothing was
// ever sent — a saved alert did literally nothing. This module closes the loop:
// match fresh opportunities against saved filters, remember what was already sent,
// and hand the message to the configured SMS provider.
//
// Design rules:
//   · Only genuinely good, trusted listings trigger an alert. Waking someone at
//     night for a «قیمت منصفانه» ad destroys the feature's credibility.
//   · Every (alert, listing) pair is delivered at most once, ever.
//   · Quiet hours are respected; messages queue instead of firing at 3am.

import { filterListingItems } from './analyzer.js'

export const DEFAULT_MIN_SCORE = 70
const ALLOWED_GRADES = new Set(['exceptional', 'strong'])

/** Parse «۲۲:۰۰ تا ۸:۰۰» into a pair of hours. */
export function parseQuietHours(text = '') {
  const latin = String(text).replace(/[۰-۹]/g, d => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d))
  const match = latin.match(/(\d{1,2})\s*:?\d*\s*(?:تا|-|–)\s*(\d{1,2})/)
  if (!match) return null
  return { from: Number(match[1]) % 24, to: Number(match[2]) % 24 }
}

export function inQuietHours(date, quiet) {
  if (!quiet) return false
  // Tehran local hour.
  const hour = Number(new Intl.DateTimeFormat('en-US', { hour: 'numeric', hour12: false, timeZone: 'Asia/Tehran' }).format(date))
  return quiet.from > quiet.to
    ? (hour >= quiet.from || hour < quiet.to)   // overnight window
    : (hour >= quiet.from && hour < quiet.to)
}

/** Listings worth interrupting a human for. */
export function alertWorthy(items, { minScore = DEFAULT_MIN_SCORE } = {}) {
  return (items || []).filter(item =>
    item.trust === 'ok' &&
    item.eligible === true &&
    !item.suspicious &&
    ALLOWED_GRADES.has(item.grade) &&
    Number(item.score) >= minScore)
}

export function renderMessage(template, item, alert) {
  const million = value => Math.round((Number(value) || 0) / 1e6).toLocaleString('fa-IR')
  const body = String(template || 'فرصت تازه مطابق جست‌وجوی شما پیدا شد.')
  return body
    .replace(/\{\{\s*title\s*\}\}/g, item.title || '')
    .replace(/\{\{\s*price\s*\}\}/g, million(item.price))
    .replace(/\{\{\s*market\s*\}\}/g, million(item.market))
    .replace(/\{\{\s*discount\s*\}\}/g, Math.round(item.discount || 0).toLocaleString('fa-IR'))
    .replace(/\{\{\s*alert\s*\}\}/g, alert?.title || '')
    .replace(/\{\{\s*link\s*\}\}/g, item.link || '')
    || 'فرصت تازه پیدا شد.'
}

/**
 * Match every enabled alert against the current opportunity set.
 * @param deps.store      database handle
 * @param deps.itemsFor   (category) => analyzed items
 * @param deps.sendSms    async ({phone, text}) => boolean   (optional)
 */
export async function dispatchAlerts({ store, itemsFor, sendSms = null, now = new Date(), limitPerAlert = 3 } = {}) {
  const settings = store.settings()
  if (settings.notification_master === 'false' || settings.sms_alert_enabled === 'false') {
    return { skipped: 'NOTIFICATIONS_DISABLED', sent: 0, matched: 0 }
  }
  const quiet = parseQuietHours(settings.quiet_hours)
  if (inQuietHours(now, quiet)) return { skipped: 'QUIET_HOURS', sent: 0, matched: 0 }

  const alerts = store.enabledAlerts()
  if (!alerts.length) return { sent: 0, matched: 0, alerts: 0 }

  const minScore = Math.max(50, Number(settings.score_good_min) || DEFAULT_MIN_SCORE)
  const cache = new Map()
  let matched = 0, sent = 0, queued = 0

  for (const alert of alerts) {
    let filters = {}
    try { filters = JSON.parse(alert.filters || '{}') } catch { filters = {} }
    const category = filters.category || 'light'
    if (!cache.has(category)) cache.set(category, alertWorthy(itemsFor(category), { minScore }))
    const pool = cache.get(category)

    const matches = filterListingItems(pool, {
      queryText: filters.query || filters.queryText || '',
      cityNames: filters.cityNames || [],
      minPrice: filters.minPrice, maxPrice: filters.maxPrice,
      minYear: filters.minYear, maxYear: filters.maxYear,
      maxUsage: filters.maxUsage,
      sort: 'score',
    }).slice(0, limitPerAlert)

    for (const item of matches) {
      const id = String(item.id ?? item.token ?? '')
      if (!id || store.alertAlreadySent(alert.id, id)) continue
      matched += 1
      const text = renderMessage(settings.opportunity_template, item, alert)
      let delivered = false
      if (sendSms && alert.phone) {
        try { delivered = Boolean(await sendSms({ phone: alert.phone, text })) } catch { delivered = false }
      }
      store.recordAlertDelivery(alert.id, alert.user_id, id, text, delivered ? 'sent' : 'queued')
      if (delivered) sent += 1; else queued += 1
    }
  }
  return { alerts: alerts.length, matched, sent, queued }
}
