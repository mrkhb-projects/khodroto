// همراه مکانیک (hamrah-mechanic.com) — daily USED-car (کارکرده) valuations.
//
// This is the important one for us: our platform mostly analyses second-hand ads,
// and همراه مکانیک publishes a per-model, per-build-year کارشناسی price derived from
// real transactions. Page shape:
//   /carprice/{brand}/{model}/            → "قیمت دیگر سال‌ها" table, one row per year
//   /carprice/{brand}/{model}/{year}/     → min / typical / max for that year
//
// We only read the model index page: one request gives every build year at once,
// which keeps the crawl polite.

import { fetchText, parseToman, plausiblePrice, toLatinDigits, sleep } from './common.js'

const BASE = 'https://www.hamrah-mechanic.com'

// The models we anchor on. Kept deliberately small and high-traffic: these are the
// cars where fake/instalment ads do the most damage to an average.
export const TRACKED_MODELS = [
  // --- سایپا ---
  { brand: 'سایپا', model: 'کوییک', path: '/carprice/saipa/quick/' },
  { brand: 'سایپا', model: 'پراید', path: '/carprice/saipa/pride/' },
  { brand: 'سایپا', model: 'تیبا', path: '/carprice/saipa/tiba/' },
  { brand: 'سایپا', model: 'ساینا', path: '/carprice/saipa/saina/' },
  { brand: 'سایپا', model: 'شاهین', path: '/carprice/saipa/shahin/' },
  { brand: 'سایپا', model: 'اطلس', path: '/carprice/saipa/atlas/' },
  { brand: 'سایپا', model: 'سهند', path: '/carprice/saipa/sahand/' },
  { brand: 'سایپا', model: 'آریو', path: '/carprice/saipa/ario/' },
  // --- پژو ---
  { brand: 'پژو', model: 'پژو ۲۰۶', path: '/carprice/peugeot/206/' },
  { brand: 'پژو', model: 'پژو ۲۰۶ اس دی', path: '/carprice/peugeot/206-sd/' },
  { brand: 'پژو', model: 'پژو ۲۰۷', path: '/carprice/peugeot/207i/' },
  { brand: 'پژو', model: 'پژو ۴۰۵', path: '/carprice/peugeot/405/' },
  { brand: 'پژو', model: 'پژو پارس', path: '/carprice/peugeot/pars/' },
  { brand: 'پژو', model: 'پژو ۲۰۰۸', path: '/carprice/peugeot/2008/' },
  { brand: 'پژو', model: 'پژو روآ', path: '/carprice/peugeot/roa/' },
  // --- ایران خودرو ---
  { brand: 'ایران خودرو', model: 'سمند', path: '/carprice/irankhodro/samand/' },
  { brand: 'ایران خودرو', model: 'سورن', path: '/carprice/irankhodro/samand-soren/' },
  { brand: 'ایران خودرو', model: 'دنا', path: '/carprice/irankhodro/dena/' },
  { brand: 'ایران خودرو', model: 'تارا', path: '/carprice/irankhodro/tara/' },
  { brand: 'ایران خودرو', model: 'رانا', path: '/carprice/irankhodro/runna/' },
  { brand: 'ایران خودرو', model: 'آریسان', path: '/carprice/irankhodro/arisun/' },
  { brand: 'ایران خودرو', model: 'ری را', path: '/carprice/irankhodro/rira/' },
  // --- رنو ---
  { brand: 'رنو', model: 'ال نود', path: '/carprice/renault/l90/' },
  { brand: 'رنو', model: 'ساندرو', path: '/carprice/renault/sandero/' },
  { brand: 'رنو', model: 'پارس تندر', path: '/carprice/renault/pars-tondar/' },
  { brand: 'رنو', model: 'مگان', path: '/carprice/renault/megane/' },
  // --- کیا / هیوندای ---
  { brand: 'کیا', model: 'سراتو', path: '/carprice/kia/cerato/' },
  { brand: 'کیا', model: 'اپتیما', path: '/carprice/kia/optima/' },
  { brand: 'کیا', model: 'ریو', path: '/carprice/kia/rio/' },
  { brand: 'کیا', model: 'اسپورتیج', path: '/carprice/kia/sportage/' },
  { brand: 'هیوندای', model: 'اکسنت', path: '/carprice/hyundai/accent/' },
  { brand: 'هیوندای', model: 'النترا', path: '/carprice/hyundai/elantra/' },
  { brand: 'هیوندای', model: 'سوناتا', path: '/carprice/hyundai/sonata/' },
  { brand: 'هیوندای', model: 'توسان', path: '/carprice/hyundai/tucson/' },
  { brand: 'هیوندای', model: 'i20', path: '/carprice/hyundai/i20/' },
  // --- چینی‌های پرتیراژ ---
  { brand: 'ام وی ام', model: 'ام وی ام X22', path: '/carprice/mvm/x22/' },
  { brand: 'ام وی ام', model: 'ام وی ام X33', path: '/carprice/mvm/x33/' },
  { brand: 'ام وی ام', model: 'ام وی ام ۳۱۵', path: '/carprice/mvm/315/' },
  { brand: 'چری', model: 'آریزو ۵', path: '/carprice/chery/arrizo-5/' },
  { brand: 'چری', model: 'تیگو ۷', path: '/carprice/chery/tiggo-7/' },
  { brand: 'جک', model: 'جک J4', path: '/carprice/jac/j4/' },
  { brand: 'جک', model: 'جک S3', path: '/carprice/jac/s3/' },
  { brand: 'جک', model: 'جک S5', path: '/carprice/jac/s5/' },
  { brand: 'هایما', model: 'هایما S5', path: '/carprice/haima/s5/' },
  { brand: 'هایما', model: 'هایما S7', path: '/carprice/haima/s7/' },
  { brand: 'لیفان', model: 'لیفان X60', path: '/carprice/lifan/x60/' },
  // --- ژاپنی / وانت ---
  { brand: 'تویوتا', model: 'کرولا', path: '/carprice/toyota/corolla/' },
  { brand: 'تویوتا', model: 'کمری', path: '/carprice/toyota/camry/' },
  { brand: 'مزدا', model: 'مزدا ۳', path: '/carprice/mazda/3/' },
  { brand: 'زامیاد', model: 'زامیاد Z24', path: '/carprice/zamyad/z24/' },
  { brand: 'نیسان', model: 'نیسان جوک', path: '/carprice/nissan/juke/' },
]

// Rows look like: «سایپا کوییک 1403  S» … «1,160,000,000  تومان»
const YEAR_ROW_RE = /carprice\/[a-z0-9-]+\/[a-z0-9-]+\/(\d{4})\/?["'][^]{0,400}?([\d,]{9,})\s*(?:\\n|\s)*تومان/gi

/** Parse one model index page into per-year reference prices. */
export function parseModelPage(html, { brand, model }) {
  const text = toLatinDigits(html)
  const byYear = new Map()
  let match
  while ((match = YEAR_ROW_RE.exec(text))) {
    const year = Number(match[1])
    const price = parseToman(match[2])
    if (!plausiblePrice(price)) continue
    if (year < 1300 || year > 1420) continue
    // Keep the first (most authoritative) occurrence per year.
    if (!byYear.has(year)) byYear.set(year, price)
  }
  return [...byYear.entries()]
    .map(([year, price]) => ({ brand, model, trim: '', year, price, condition: 'used' }))
    .sort((a, b) => b.year - a.year)
}

export async function hamrahMechanicPrices({ models = TRACKED_MODELS, delayMs = Number(process.env.REFERENCE_DELAY_MS) || 1500 } = {}) {
  const rows = []
  const failures = []
  for (const entry of models) {
    try {
      const html = await fetchText(`${BASE}${entry.path}`)
      const parsed = parseModelPage(html, entry)
      if (!parsed.length) failures.push(`${entry.model}: no rows`)
      rows.push(...parsed.map(row => ({ ...row, url: `${BASE}${entry.path}` })))
    } catch (error) {
      failures.push(`${entry.model}: ${error.message}`)
    }
    if (delayMs) await sleep(delayMs)
  }
  if (!rows.length) {
    return { source: 'hamrah-mechanic', rows: [], note: `ALL_FAILED — ${failures.slice(0, 3).join(' · ')}` }
  }
  return { source: 'hamrah-mechanic', rows, fetchedAt: new Date().toISOString(), note: failures.length ? `PARTIAL — ${failures.length} model(s) failed` : '' }
}
