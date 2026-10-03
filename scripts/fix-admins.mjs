#!/usr/bin/env node
// Audit and repair administrator accounts.
//
// WHY THIS EXISTS
// Until the security fix, verifyOtp promoted a user to admin whenever NODE_ENV
// was not exactly 'production'. `npm start` is plain `node server.js` and only
// app.js sets NODE_ENV, so on a host started the ordinary way EVERY person who
// signed in with a phone number silently became an administrator. Deploying the
// fix stops new promotions; it does not demote the accounts already promoted.
//
//   node scripts/fix-admins.mjs                     → list admins, change nothing
//   node scripts/fix-admins.mjs --keep 09123334444  → demote everyone else
//   node scripts/fix-admins.mjs --keep 09123334444 --logout-others
//
// Nothing is written unless --keep is given, and a timestamped backup of the
// database is taken first.

import { DatabaseSync } from 'node:sqlite'
import fs from 'node:fs'
import path from 'node:path'

const args = process.argv.slice(2)
const flag = name => {
  const index = args.indexOf(name)
  return index === -1 ? null : (args[index + 1] || '')
}
const has = name => args.includes(name)

const file = flag('--db') || process.env.DATABASE_FILE || 'data/khodroto.db'
const keep = (flag('--keep') || process.env.ADMIN_PHONE || '').trim()
const logoutOthers = has('--logout-others')

if (!fs.existsSync(file)) {
  console.error(`✗ فایل دیتابیس پیدا نشد: ${path.resolve(file)}`)
  console.error('  مسیر درست را با --db بدهید، مثلاً:  node scripts/fix-admins.mjs --db ~/khodroto/data/khodroto.db')
  process.exit(1)
}

const db = new DatabaseSync(file)
const admins = db.prepare("SELECT id,phone,name,created_at FROM users WHERE role='admin' ORDER BY id").all()
const total = db.prepare('SELECT COUNT(*) n FROM users').get().n

console.log(`\nدیتابیس : ${path.resolve(file)}`)
console.log(`کاربران  : ${total}`)
console.log(`مدیران   : ${admins.length}\n`)
for (const admin of admins) {
  const mark = keep && admin.phone === keep ? '  ← نگه داشته می‌شود' : ''
  console.log(`  #${admin.id}  ${admin.phone}  ${admin.name || ''}  (${(admin.created_at || '').slice(0, 10)})${mark}`)
}

if (!keep) {
  console.log('\nفقط گزارش گرفته شد؛ چیزی تغییر نکرد.')
  console.log('برای اصلاح، شمارهٔ خودتان را بدهید:')
  console.log('  node scripts/fix-admins.mjs --keep 09123334444\n')
  process.exit(0)
}

if (!/^09\d{9}$/.test(keep)) {
  console.error(`\n✗ شمارهٔ «${keep}» معتبر نیست. قالب درست: 09123334444\n`)
  process.exit(1)
}

// Refusing here is the whole point: demoting every admin, including a phone that
// does not exist in this database, would lock the panel completely.
const owner = db.prepare('SELECT id FROM users WHERE phone=?').get(keep)
if (!owner) {
  console.error(`\n✗ شمارهٔ ${keep} در این دیتابیس کاربری ندارد.`)
  console.error('  اول یک‌بار با همین شماره در سایت وارد شوید، بعد این دستور را اجرا کنید.')
  console.error('  (در غیر این صورت هیچ مدیری باقی نمی‌ماند.)\n')
  process.exit(1)
}

const backup = `${file}.backup-${new Date().toISOString().replace(/[:.]/g, '-')}`
fs.copyFileSync(file, backup)
console.log(`\nنسخهٔ پشتیبان: ${backup}`)

const demoted = db.prepare("UPDATE users SET role='user' WHERE role='admin' AND phone<>?").run(keep).changes
db.prepare("UPDATE users SET role='admin' WHERE phone=?").run(keep)

let loggedOut = 0
if (logoutOthers) {
  // Role is read from the users table on every request, so a demotion takes
  // effect immediately — but clearing the sessions ends any open panel tab too.
  loggedOut = db.prepare('DELETE FROM sessions WHERE user_id<>?').run(owner.id).changes
}

const remaining = db.prepare("SELECT phone FROM users WHERE role='admin'").all().map(row => row.phone)
console.log(`\n✓ ${demoted} حساب از مدیریت خارج شد`)
if (logoutOthers) console.log(`✓ ${loggedOut} نشست فعال بسته شد`)
console.log(`✓ مدیر باقی‌مانده: ${remaining.join('، ') || '—'}`)
console.log('\nحالا ADMIN_PHONE و ADMIN_PASSWORD را در متغیرهای محیطی هاست تنظیم و برنامه را ری‌استارت کنید.\n')
