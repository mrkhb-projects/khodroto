#!/usr/bin/env node
// Reclaim disk space on the hosting account.
//
//   node scripts/prune-storage.mjs            → show what would be freed (safe, read-only)
//   node scripts/prune-storage.mjs --apply    → actually prune, then VACUUM the database
//   node scripts/prune-storage.mjs --apply --aggressive
//                                             → also drop removed listings and the whole
//                                               Divar cache file
//
// Nothing here touches users, subscriptions, orders, discount codes, dealer
// inventory, dealer leads, tickets or settings. Only derived/append-only data
// that the app can rebuild is removed.
//
// Retention windows come from the admin panel settings when they exist, so the
// values the operator already set in «پشتیبان‌گیری و نگهداری» are respected.

import { DatabaseSync } from 'node:sqlite'
import fs from 'node:fs'
import path from 'node:path'

const apply = process.argv.includes('--apply')
const aggressive = process.argv.includes('--aggressive')
const databaseFile = process.env.DATABASE_FILE || 'data/khodroto.db'
const cacheFile = process.env.DIVAR_CACHE_FILE || 'data/divar-cache.json'

const bytes = value => {
  if (!Number.isFinite(value) || value <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const index = Math.min(units.length - 1, Math.floor(Math.log(value) / Math.log(1024)))
  return `${(value / 1024 ** index).toFixed(index ? 1 : 0)} ${units[index]}`
}
const sizeOf = file => { try { return fs.statSync(file).size } catch { return 0 } }
const isoDaysAgo = days => new Date(Date.now() - days * 86400000).toISOString()

function databaseFootprint(file) {
  // WAL mode keeps two sidecar files that can each outgrow the database itself.
  return ['', '-wal', '-shm'].reduce((total, suffix) => total + sizeOf(`${file}${suffix}`), 0)
}

if (!fs.existsSync(databaseFile)) {
  console.error(`✖ دیتابیس پیدا نشد: ${databaseFile}`)
  console.error('  اگر روی هاست هستید، DATABASE_FILE را ست کنید یا از ریشه‌ی اپ اجرا کنید.')
  process.exit(1)
}

const db = new DatabaseSync(databaseFile)
const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row => row.name))
const has = name => tables.has(name)

function setting(key, fallback) {
  if (!has('settings')) return fallback
  const row = db.prepare('SELECT value FROM settings WHERE key=?').get(key)
  const parsed = Number(row?.value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

const logDays = setting('log_retention_days', 90)
const auditDays = setting('audit_retention_days', 365)
const inactiveDays = setting('inactive_listing_days', 30)

// Each job: a label, the table it touches, and the DELETE it would run.
const jobs = [
  { label: `گزارش فعالیت مدیریت قدیمی‌تر از ${auditDays} روز`, table: 'audit_logs', sql: 'DELETE FROM audit_logs WHERE created_at<?', args: [isoDaysAgo(auditDays)] },
  { label: `لاگ اجرای کراولر قدیمی‌تر از ${logDays} روز`, table: 'crawler_runs', sql: 'DELETE FROM crawler_runs WHERE started_at<?', args: [isoDaysAgo(logDays)] },
  { label: `صف ارسال هشدارها قدیمی‌تر از ${logDays} روز`, table: 'alert_deliveries', sql: 'DELETE FROM alert_deliveries WHERE created_at<?', args: [isoDaysAgo(logDays)] },
  { label: `تاریخچه قیمت قدیمی‌تر از ${Math.max(logDays, 180)} روز`, table: 'price_history', sql: 'DELETE FROM price_history WHERE recorded_at<?', args: [isoDaysAgo(Math.max(logDays, 180))] },
  { label: `رصد روزانه آگهی قدیمی‌تر از ${Math.max(inactiveDays, 60)} روز`, table: 'listing_observations', sql: 'DELETE FROM listing_observations WHERE observed_date<?', args: [isoDaysAgo(Math.max(inactiveDays, 60)).slice(0, 10)] },
  { label: 'نمودار تاریخی میانگین بازار قدیمی‌تر از ۳۶۵ روز', table: 'baseline_history', sql: 'DELETE FROM baseline_history WHERE captured_on<?', args: [isoDaysAgo(365).slice(0, 10)] },
  { label: 'کدهای یک‌بارمصرف منقضی', table: 'otp_codes', sql: 'DELETE FROM otp_codes WHERE expires_at<?', args: [Date.now()] },
  { label: 'نشست‌های منقضی', table: 'sessions', sql: 'DELETE FROM sessions WHERE expires_at<?', args: [Date.now()] },
]

if (aggressive) {
  jobs.push(
    { label: `آگهی‌های حذف‌شده قدیمی‌تر از ${inactiveDays} روز`, table: 'listings', sql: "DELETE FROM listings WHERE status IN ('removed','inactive') AND COALESCE(removed_at,inactive_at,last_seen_at)<?", args: [isoDaysAgo(inactiveDays)] },
    { label: 'جزئیات آگهی‌های حذف‌شده (یتیم)', table: 'listing_details', sql: 'DELETE FROM listing_details WHERE token NOT IN (SELECT token FROM listings)', args: [] },
    { label: 'تاریخچه قیمت آگهی‌های حذف‌شده (یتیم)', table: 'price_history', sql: 'DELETE FROM price_history WHERE token NOT IN (SELECT token FROM listings)', args: [] },
    { label: 'رصد روزانه آگهی‌های حذف‌شده (یتیم)', table: 'listing_observations', sql: 'DELETE FROM listing_observations WHERE token NOT IN (SELECT token FROM listings)', args: [] },
  )
}

const beforeDb = databaseFootprint(databaseFile)
const beforeCache = sizeOf(cacheFile)

console.log(`\nدیتابیس : ${databaseFile}  (${bytes(beforeDb)} با فایل‌های WAL)`)
console.log(`کش دیوار: ${cacheFile}  (${bytes(beforeCache)})`)
console.log(apply ? '\nحالت: اجرای واقعی\n' : '\nحالت: فقط گزارش (برای اجرای واقعی --apply بدهید)\n')

let total = 0
for (const job of jobs) {
  if (!has(job.table)) continue
  const countSql = job.sql.replace(/^DELETE FROM (\w+)/, 'SELECT COUNT(*) AS n FROM $1')
  let rows = 0
  try { rows = db.prepare(countSql).get(...job.args)?.n || 0 } catch { continue }
  if (!rows) continue
  total += rows
  if (apply) db.prepare(job.sql).run(...job.args)
  console.log(`${apply ? '✔ حذف شد' : '•  قابل حذف'}: ${rows.toLocaleString('en-US')} ردیف — ${job.label}`)
}
if (!total) console.log('• دیتابیس تمیز است؛ ردیف قابل حذفی پیدا نشد.')

// The Divar cache is a plain JSON blob: trim it to the newest entries instead of
// deleting it outright, so the site keeps answering while Divar is unreachable.
let cacheNote = ''
if (beforeCache) {
  try {
    const stored = JSON.parse(fs.readFileSync(cacheFile, 'utf8'))
    const entries = Array.isArray(stored.entries) ? stored.entries : []
    const limit = Math.max(10, Number(process.env.DIVAR_CACHE_MAX_ENTRIES) || 150)
    const maxAge = Date.now() - Math.max(1, Number(process.env.DIVAR_CACHE_MAX_AGE_HOURS) || 72) * 3600000
    const kept = aggressive
      ? []
      : entries.filter(([, value]) => value?.time > maxAge).sort((a, b) => (b[1]?.time || 0) - (a[1]?.time || 0)).slice(0, limit)
    if (kept.length < entries.length) {
      cacheNote = `${entries.length - kept.length} ورودی از ${entries.length} ورودی کش`
      if (apply) {
        if (!kept.length) fs.rmSync(cacheFile, { force: true })
        else fs.writeFileSync(cacheFile, JSON.stringify({ version: 1, entries: kept }))
      }
      console.log(`${apply ? '✔ حذف شد' : '•  قابل حذف'}: ${cacheNote}`)
    }
  } catch { console.warn('⚠ کش دیوار قابل خواندن نبود؛ دست‌نخورده ماند.') }
}

if (apply) {
  // Deleting rows only frees pages inside the file; VACUUM returns them to the
  // filesystem, and the WAL checkpoint collapses the -wal sidecar.
  console.log('\nدر حال فشرده‌سازی دیتابیس…')
  db.exec('PRAGMA wal_checkpoint(TRUNCATE);')
  db.exec('VACUUM;')
}
db.close()

const afterDb = databaseFootprint(databaseFile)
const afterCache = sizeOf(cacheFile)
const freed = beforeDb - afterDb + (beforeCache - afterCache)

console.log('\n' + '─'.repeat(52))
if (apply) {
  console.log(`دیتابیس : ${bytes(beforeDb)} → ${bytes(afterDb)}`)
  console.log(`کش دیوار: ${bytes(beforeCache)} → ${bytes(afterCache)}`)
  console.log(`آزاد شد : ${bytes(Math.max(0, freed))}`)
} else {
  console.log('چیزی حذف نشد (حالت گزارش).')
  console.log('برای اجرای واقعی:  node scripts/prune-storage.mjs --apply')
}
console.log('─'.repeat(52) + '\n')
