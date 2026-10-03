// بازارخودرو (bazarkhodro.ir) — daily NEW-car (صفر) market prices.
//
// The price list is server-rendered and every row is an anchor of the shape
//   /price/{brand-slug}/{model-slug}_{trim-slug}/{year}[/{importer}]
// followed by the Toman amount. That makes it the cleanest machine-readable
// reference available: brand, model, trim and build year all come from the URL,
// so we never have to guess them out of free text.

import { fetchText, parseToman, plausiblePrice, toLatinDigits } from './common.js'

const BASE = 'https://bazarkhodro.ir'
const LIST_URL = process.env.BAZARKHODRO_URL || `${BASE}/price`

// /price/saipa/quick_s/1405  → brand=saipa model=quick trim=s year=1405
const ROW_RE = /href="(\/price\/([a-z0-9-]+)\/([a-z0-9-]+?)(?:_([a-z0-9-]+))?\/(\d{4})(?:\/[^"]*)?)"/gi

const SLUG_TO_FA = {
  saipa: 'سایپا', 'iran-khodro': 'ایران خودرو', irankhodro: 'ایران خودرو', peugeot: 'پژو',
  pride: 'پراید', quick: 'کوییک', saina: 'ساینا', shahin: 'شاهین', atlas: 'اطلس', tiba: 'تیبا',
  dena: 'دنا', tara: 'تارا', rana: 'رانا', samand: 'سمند', soren: 'سورن', arisan: 'آریسان',
  mvm: 'ام وی ام', chery: 'چری', arrizo: 'آریزو', tiggo: 'تیگو', jac: 'جک', kmc: 'کی ام سی',
  mazda: 'مزدا', renault: 'رنو', toyota: 'تویوتا', hyundai: 'هیوندای', kia: 'کیا',
  nissan: 'نیسان', suzuki: 'سوزوکی', bmw: 'بی ام و', mercedesbenz: 'بنز', benz: 'بنز',
  lexus: 'لکسوس', volvo: 'ولوو', porsche: 'پورشه', volkswagen: 'فولکس واگن', skoda: 'اشکودا',
  haima: 'هایما', lifan: 'لیفان', besturn: 'بسترن', dongfeng: 'دانگ فنگ', changan: 'چانگان',
  geely: 'جیلی', lamari: 'لاماری', zamyad: 'زامیاد', fidelity: 'فیدلیتی', dignity: 'دیگنیتی',
  respect: 'ریسپکت', capra: 'کاپرا', mg: 'ام جی', honda: 'هوندا', audi: 'آئودی', opel: 'اپل',
}

const faLabel = slug => SLUG_TO_FA[slug] || String(slug || '').replace(/-/g, ' ')

/**
 * Pull the whole daily price board.
 * Returns rows of { brand, model, trim, year, price } already sanity-checked.
 */
export async function bazarkhodroPrices({ url = LIST_URL } = {}) {
  let html
  try {
    html = await fetchText(url)
  } catch (error) {
    return { source: 'bazarkhodro', rows: [], note: `FETCH_FAILED: ${error.message}` }
  }

  const text = toLatinDigits(html)
  const rows = []
  const seen = new Set()
  let match

  while ((match = ROW_RE.exec(text))) {
    const [, href, brandSlug, modelSlug, trimSlug, yearRaw] = match
    if (seen.has(href)) continue
    seen.add(href)

    // The amount is rendered immediately after the anchor text; take the first
    // 6+ digit number inside a short window so we never cross into the next row.
    const window = text.slice(match.index, match.index + 1400)
    const price = parseToman(window.replace(/href="[^"]*"/g, ' '))
    if (!plausiblePrice(price)) continue

    const year = Number(yearRaw)
    // Accept Jalali 13xx/14xx and Gregorian 19xx/20xx; identity layer unifies later.
    if (!((year >= 1300 && year <= 1420) || (year >= 1950 && year <= 2100))) continue

    rows.push({
      brand: faLabel(brandSlug),
      model: faLabel(modelSlug),
      trim: trimSlug ? faLabel(trimSlug) : '',
      year,
      price,
      condition: 'new',
      url: `${BASE}${href}`,
    })
  }

  if (!rows.length) return { source: 'bazarkhodro', rows: [], note: 'SHAPE_CHANGED — no price rows matched' }
  return { source: 'bazarkhodro', rows, fetchedAt: new Date().toISOString() }
}
