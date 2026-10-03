// همراه مکانیک — inspected used-car listings (cars-for-sale).
//
// Every car here has been through a technical inspection, so these listings are the
// cleanest signal we can get: fake and instalment-bait ads are rare. That makes them
// valuable both as listings AND as a quality check on the Divar-derived baseline.

import { cardChunks, faNumber, fetchText, relativeFreshness, toJalaliYear, toLatinDigits } from './common.js'

const BASE = 'https://www.hamrah-mechanic.com'

export function parseHamrahCards(html) {
  return cardChunks(html, /href="(\/cars-for-sale\/[^"?#]+)"/gi).map(card => {
    const text = card.chunks.join(' | ')
    const latin = toLatinDigits(text)
    const priceMatch = latin.match(/([\d,]{9,})/)
    if (!priceMatch) return null
    const price = faNumber(priceMatch[1])
    if (!price || price < 50_000_000) return null

    const kmMatch = latin.match(/([\d,]{3,})\s*(?:km|کیلومتر)/i)
    const yearMatch = latin.match(/(?:^|\D)(1[34]\d{2}|20\d{2})(?!\d)/)
    const noise = /تومان|km|کیلومتر|قیمت|اقساط|کارشناسی|معاوضه|مشاهده|درحال/i
    const title = card.chunks.filter(chunk => !noise.test(chunk) && chunk.length > 4).sort((a, b) => b.length - a.length)[0] || 'خودرو'
    const city = card.chunks.find(chunk => /^(تهران|کرج|مشهد|اصفهان|تبریز|شیراز|اهواز|قم|رشت|کرمان|شاهین شهر)/.test(chunk)) || 'نامشخص'
    const slug = card.href.replace(/\/+$/, '').split('/').pop()

    return {
      id: `hamrah:${slug}`,
      token: `hamrah:${slug}`,
      source: 'همراه مکانیک',
      title,
      year: yearMatch ? toJalaliYear(yearMatch[1]) : 0,
      km: kmMatch ? faNumber(kmMatch[1]) : 0,
      color: '—',
      city,
      price,
      // These ads carry an inspection report, which our scoring can reward.
      inspected: /کارشناسی شده/.test(text),
      freshness: relativeFreshness(card.chunks.find(chunk => /پیش|لحظ/.test(chunk)) || 'تازه'),
      link: card.href.startsWith('http') ? card.href : `${BASE}${card.href}`,
      image: /src="(https:\/\/cdn\.hamrah-mechanic\.com[^"]+)"/.exec(card.html)?.[1]?.split('?')[0] || null,
    }
  }).filter(Boolean)
}

export async function hamrahMechanicListings({ category = 'light', pages = 3 } = {}) {
  if (category !== 'light') return { provider: 'hamrahmechanic', category, items: [], note: 'UNSUPPORTED_CATEGORY' }
  const items = []
  for (let page = 1; page <= pages; page++) {
    try {
      const html = await fetchText(`${BASE}/cars-for-sale/?page=${page}`)
      const parsed = parseHamrahCards(html)
      if (!parsed.length && page === 1) return { provider: 'hamrahmechanic', category, items: [], note: 'SHAPE_CHANGED — no cards matched' }
      items.push(...parsed)
    } catch (error) {
      return { provider: 'hamrahmechanic', category, items, note: `PARTIAL_${page - 1}_PAGES: ${error.message}` }
    }
  }
  return { provider: 'hamrahmechanic', category, items, scope: `hamrah:${category}`, totalAnalyzed: items.length }
}
