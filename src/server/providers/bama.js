import { cardChunks, faNumber, fetchText, relativeFreshness, toJalaliYear, toLatinDigits } from './common.js'

// باما دیوار را از نظر جریان ازریل «بازار واقعی خودرو» با کارت‌های SSR کامل ارائه می‌دهد.
// What we know (verified 2026-10-02): /car cards contain
//   «پژو، 206 SD» + trim + «1394.کارکرد 170,000 کیلومتر» + freshness + «تهران، آبشار» + «1,320,000,000تومان»
const BAMA_CATEGORIES = {
  light: 'car',
  motorcycles: 'motorcycle',
  heavy: 'truck',
}

export function parseBamaCards(html, endpoint = 'car') {
  return cardChunks(html, /href="(\/(?:car|motorcycle|truck)\/detail-[^"]+)"/g).map(card => {
    const text = card.chunks.join(' | ')
    const latin = toLatinDigits(text)
    const mileage = latin.match(/(\d{3,4})\s*\.?\s*کارکرد\s*([\d,]+)\s*کیلومتر/)
    const price = latin.match(/([\d,]{6,})\s*تومان/)
    if (!price) return null
    const year = mileage ? toJalaliYear(mileage[1]) : 0
    const freshness = card.chunks.find(chunk => /پیش/.test(chunk)) || 'تازه'
    const priceText = toLatinDigits(price[1])
    const nonInfo = new Set([mileage?.[0], price?.[0], freshness].filter(Boolean))
    const infoChunks = card.chunks.filter(chunk => !nonInfo.has(toLatinDigits(chunk)) && !nonInfo.has(chunk) && !/پیش|تومان|کارکرد|احراز هویت/.test(chunk))
    const separatorIndex = infoChunks.findIndex(chunk => chunk.includes('،'))
    const titleChunk = separatorIndex >= 0 ? infoChunks[separatorIndex] : infoChunks[0] || 'خودرو'
    const trimChunk = infoChunks[separatorIndex >= 0 ? separatorIndex + 1 : 1] || ''
    const cityChunk = [...infoChunks].reverse().find(chunk => chunk.includes('،') && !chunk.includes(priceText)) || titleChunk
    return {
      id: `bama:${card.href.match(/detail-(\w+)/)?.[1] || card.href}`,
      token: `bama:${card.href.match(/detail-(\w+)/)?.[1] || card.href}`,
      source: 'باما',
      title: trimChunk && !cityChunk.includes(trimChunk) ? `${titleChunk} ${trimChunk}` : titleChunk,
      year,
      km: mileage ? faNumber(mileage[2]) : 0,
      color: '—',
      city: cityChunk === titleChunk ? 'نامشخص' : cityChunk,
      price: faNumber(price[1]),
      freshness: relativeFreshness(freshness),
      link: card.href.startsWith('http') ? card.href : `https://bama.ir${card.href}`,
      image: /src="(https:\/\/cdn-sth1\.bama\.ir[^"]+)"/.exec(card.html)?.[1]?.split('?')[0] || null,
      endpoint,
    }
  }).filter(Boolean)
}

export async function bamaListings({ category = 'light', pages = 3 } = {}) {
  const endpoint = BAMA_CATEGORIES[category]
  if (!endpoint) return { provider: 'bama', category, items: [], note: 'UNSUPPORTED_CATEGORY' }
  const items = []
  for (let page = 1; page <= pages; page++) {
    try {
      const html = await fetchText(`https://bama.ir/${endpoint}?sort=latest&page=${page}`)
      items.push(...parseBamaCards(html, endpoint))
    } catch (error) {
      // بلوک شدن یا تغییر ساختار هرگز نباید جریان دیوار را خراب کند.
      return { provider: 'bama', category, items, note: `PARTIAL_${page - 1}_PAGES: ${error.message}` }
    }
  }
  // «احراز هویت‌شده» signals bama-verified listings; keep everything — scoring is ours.
  return { provider: 'bama', category, items, scope: `bama:${category}`, totalAnalyzed: items.length }
}
