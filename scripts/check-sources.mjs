#!/usr/bin/env node
// Pre-flight check for the extra ad sources (Bama / Sheypoor / Ring).
//
// Run this ON THE SERVER before switching a source on in production:
//   node scripts/check-sources.mjs            → test every source
//   node scripts/check-sources.mjs bama       → test one source
//
// It temporarily force-enables each provider in this process only, so nothing in
// the live site changes. Exit code is 0 when at least one source returned rows.

import { bamaListings } from '../src/server/providers/bama.js'
import { sheypoorListings } from '../src/server/providers/sheypoor.js'
import { ringListings } from '../src/server/providers/ring.js'
import { khodro45Listings } from '../src/server/providers/khodro45.js'
import { hamrahMechanicListings } from '../src/server/providers/hamrahmechanic.js'
import { identifyVehicle } from '../src/server/vehicle-identity.js'

const SOURCES = {
  bama: { label: 'باما', run: bamaListings, env: 'BAMA_ENABLED' },
  sheypoor: { label: 'شیپور', run: sheypoorListings, env: 'SHEYPOOR_ENABLED' },
  ring: { label: 'رینگ', run: ringListings, env: 'RING_ENABLED' },
  khodro45: { label: 'خودرو ۴۵', run: khodro45Listings, env: 'KHODRO45_ENABLED' },
  hamrahmechanic: { label: 'همراه مکانیک', run: hamrahMechanicListings, env: 'HAMRAH_LISTINGS_ENABLED' },
}

const wanted = process.argv.slice(2).filter(arg => SOURCES[arg])
const targets = wanted.length ? wanted : Object.keys(SOURCES)

const money = value => (value ? `${Math.round(value / 1e6).toLocaleString('fa-IR')}م` : '—')

let anyOk = false
console.log(`\nبررسی منابع آگهی — ${new Date().toLocaleString('fa-IR')}\n${'='.repeat(62)}`)

for (const key of targets) {
  const source = SOURCES[key]
  const started = Date.now()
  process.stdout.write(`\n▸ ${source.label} (${key}) … `)
  try {
    const result = await source.run({ category: 'light', pages: 1 })
    const ms = Date.now() - started
    const items = result.items || []
    if (!items.length) {
      console.log(`صفر آگهی  [${ms}ms]`)
      console.log(`  وضعیت : ${result.note || 'بدون توضیح'}`)
      console.log(`  اقدام : ${hint(key, result.note)}`)
      continue
    }
    anyOk = true
    const priced = items.filter(item => Number(item.price) > 0)
    const identified = items.filter(item => identifyVehicle(item.title, 'light').confident)
    console.log(`${items.length} آگهی  [${ms}ms]  ✔`)
    console.log(`  دارای قیمت   : ${priced.length}/${items.length}`)
    console.log(`  قابل شناسایی : ${identified.length}/${items.length}  (برای میانگین‌گیری لازم است)`)
    for (const item of items.slice(0, 3)) {
      const identity = identifyVehicle(item.title, 'light')
      console.log(`   · ${String(item.title).slice(0, 38).padEnd(40)} ${money(item.price).padStart(8)}  →  ${identity.confident ? identity.label : 'ناشناخته'}`)
    }
    if (identified.length / items.length < 0.6) {
      console.log('  ⚠ کمتر از ۶۰٪ عنوان‌ها شناسایی شدند؛ این منبع میانگین را تضعیف می‌کند. فعلاً روشن نکنید.')
    }
    console.log(`  برای فعال‌سازی: ${source.env}=true`)
  } catch (error) {
    console.log(`خطا  [${Date.now() - started}ms]`)
    console.log(`  پیام  : ${error.message}`)
    console.log(`  اقدام : ${hint(key, error.message)}`)
  }
}

function hint(key, note = '') {
  const text = String(note || '')
  if (/ENOTFOUND|EAI_AGAIN|ECONNRESET|ETIMEDOUT|fetch failed/i.test(text)) {
    return 'سرور به اینترنت/سایت مقصد دسترسی ندارد. از هاست ایران اجرا کنید یا رلهٔ خصوصی را تنظیم کنید.'
  }
  if (/403|forbidden|captcha|cloudflare/i.test(text)) {
    return 'آنتی‌بات مقصد پاسخ را بست. نرخ درخواست را کم کنید (SOURCE_DELAY_MS) و از IP ایران استفاده کنید.'
  }
  if (/SHAPE_CHANGED|UNEXPECTED|parse/i.test(text)) {
    return key === 'ring'
      ? 'ساختار API رینگ عوض شده. آدرس درست JSON را در RING_API_URL بگذارید.'
      : 'ساختار HTML منبع عوض شده؛ پارسر باید به‌روز شود. تا آن زمان منبع را خاموش نگه دارید.'
  }
  return 'منبع را خاموش نگه دارید؛ جریان اصلی دیوار دست‌نخورده کار می‌کند.'
}

// --- Reference price sources ------------------------------------------------
console.log(`\n${'='.repeat(62)}`)
console.log('منابع قیمت مرجع (قیمت روز بازار)\n')

const { collectReferencePrices, buildReferenceIndex } = await import('../src/server/reference/index.js')
let referenceOk = false
try {
  const { rows, report } = await collectReferencePrices()
  for (const entry of report) {
    const mark = entry.ok ? '✔' : '✖'
    console.log(`▸ ${entry.name} (${entry.key}) … ${entry.ok ? `${entry.rows} قیمت` : 'ناموفق'}  [${entry.ms}ms] ${mark}`)
    if (entry.raw && entry.raw !== entry.rows) console.log(`  ${entry.raw - entry.rows} ردیف قابل نگاشت به مدل‌های ما نبود`)
    if (entry.note) console.log(`  وضعیت : ${entry.note}`)
    if (!entry.ok) console.log(`  اقدام : ${hint(entry.key, entry.note)}`)
  }
  if (rows.length) {
    referenceOk = true
    const index = buildReferenceIndex(rows)
    console.log(`\n  مجموع: ${rows.length} قیمت برای ${index.cohorts} مدل`)
    for (const cohort of index.cohortList().slice(0, 5)) {
      console.log(`   · ${cohort.label.padEnd(22)} ${cohort.years} سال  |  ${Math.round(cohort.min / 1e6).toLocaleString('fa-IR')}م تا ${Math.round(cohort.max / 1e6).toLocaleString('fa-IR')}م`)
    }
    console.log('\n  ← این قیمت‌ها مبنای تشخیص آگهی فیک و اقساطی هستند.')
  } else {
    console.log('\n  ⚠ هیچ قیمت مرجعی دریافت نشد؛ تشخیص آگهی فیک فقط به آگهی‌های دیوار تکیه می‌کند.')
  }
} catch (error) {
  console.log(`✖ خطا در منابع مرجع: ${error.message}`)
}

console.log(`\n${'='.repeat(62)}`)
console.log(anyOk ? 'منابع آگهی: حداقل یکی پاسخ داد.' : 'منابع آگهی: هیچ‌کدام پاسخ نداد — همه را خاموش بگذارید.')
console.log(referenceOk ? 'منابع مرجع: فعال.\n' : 'منابع مرجع: غیرفعال — روی هاست ایران دوباره تست کنید.\n')
process.exit(anyOk || referenceOk ? 0 : 1)
