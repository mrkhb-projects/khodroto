// خودرو ۴۵ (khodro45.com) — auction-style and classified car listings.
//
// Useful because it is dealer-curated and inspection-backed, so its prices tend to
// be closer to real transactions than open classifieds. Supports cars and
// motorcycles. Public listing pages only, no auth.

import { cardChunks, faNumber, fetchText, relativeFreshness, toJalaliYear, toLatinDigits } from './common.js'

const ENDPOINTS = {
  light: 'https://khodro45.com/car/search/',
  motorcycles: 'https://khodro45.com/motorcycle/search/',
}

export function parseKhodro45Cards(html) {
  return cardChunks(html, /href="(\/(?:car|motorcycle)\/[a-z0-9-]+\/\d+\/?)"/gi).map(card => {
    const text = card.chunks.join(' | ')
    const latin = toLatinDigits(text)
    const priceMatch = latin.match(/([\d,]{7,})\s*تومان/)
    if (!priceMatch) return null
    const price = faNumber(priceMatch[1])
    if (!price || price < 20_000_000) return null

    const kmMatch = latin.match(/([\d,]{3,})\s*(?:کیلومتر|km)/i)
    const yearMatch = latin.match(/(?:^|\D)(1[34]\d{2}|20\d{2})(?!\d)/)
    const freshness = card.chunks.find(chunk => /پیش|لحظ/.test(chunk)) || 'تازه'
    const noise = /تومان|کیلومتر|کارشناسی|اقساط|مشاهده|قیمت|پیش/
    const title = card.chunks.filter(chunk => !noise.test(chunk) && chunk.length > 4).sort((a, b) => b.length - a.length)[0] || 'خودرو'
    const city = card.chunks.find(chunk => /^(تهران|کرج|مشهد|اصفهان|تبریز|شیراز|اهواز|قم|رشت|کرمان)/.test(chunk)) || 'نامشخص'
    const id = card.href.match(/\/(\d+)\/?$/)?.[1] || card.href

    return {
      id: `khodro45:${id}`,
      token: `khodro45:${id}`,
      source: 'خودرو ۴۵',
      title,
      year: yearMatch ? toJalaliYear(yearMatch[1]) : 0,
      km: kmMatch ? faNumber(kmMatch[1]) : 0,
      color: '—',
      city,
      price,
      freshness: relativeFreshness(freshness),
      link: card.href.startsWith('http') ? card.href : `https://khodro45.com${card.href}`,
      image: /src="(https:\/\/[^"]*khodro45[^"]+\.(?:webp|jpg|jpeg|png))"/i.exec(card.html)?.[1]?.split('?')[0] || null,
    }
  }).filter(Boolean)
}

export async function khodro45Listings({ category = 'light', pages = 3 } = {}) {
  const base = ENDPOINTS[category]
  if (!base) return { provider: 'khodro45', category, items: [], note: 'UNSUPPORTED_CATEGORY' }
  const items = []
  for (let page = 1; page <= pages; page++) {
    try {
      const html = await fetchText(`${base}?page=${page}`)
      const parsed = parseKhodro45Cards(html)
      if (!parsed.length && page === 1) return { provider: 'khodro45', category, items: [], note: 'SHAPE_CHANGED — no cards matched' }
      items.push(...parsed)
    } catch (error) {
      return { provider: 'khodro45', category, items, note: `PARTIAL_${page - 1}_PAGES: ${error.message}` }
    }
  }
  return { provider: 'khodro45', category, items, scope: `khodro45:${category}`, totalAnalyzed: items.length }
}
