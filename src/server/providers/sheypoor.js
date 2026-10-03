import { faNumber, fetchText, relativeFreshness, toLatinDigits } from './common.js'

// شیپور: کارت‌های عمومی آگهی در دسته‌بندی خودرو. ساختار HTML آن نسبت به باما کلاسیک‌تر
// است؛ پارس بر اساس الگوی قیمت/لینک آگهی انجام می‌شود و در صورت تغییر ساختار، بی‌صدا
// خالی برمی‌گردد (هرگز خطای حاد تولید نمی‌کند).
const SHEYPOOR_CATEGORIES = {
  light: 'https://www.sheypoor.com/iran/%D8%B3%D9%88%D8%A7%D8%B1%DB%8C-%D9%88-%D9%88%D8%A7%D9%86%D8%AA',
  motorcycles: 'https://www.sheypoor.com/iran/%D9%85%D9%88%D8%AA%D9%88%D8%B1%D8%B3%DB%8C%DA%A9%D9%84%D8%AA',
}

export function parseSheypoorCards(html) {
  const items = []
  const blocks = html.split(/<article|<div[^>]+class="[^"]*item[^"]*"/).filter(block => /تومان/.test(block) && /href="\/iran\//.test(block))
  for (const block of blocks.slice(0, 60)) {
    const id = block.match(/data-id="(\d+)"/)?.[1] || block.match(/href="(\/iran\/[a-z0-9-]+\/(\d+)[^"]*)"/)?.[2]
    const href = block.match(/href="(\/iran\/[^"]+)"/)?.[1]
    if (!id || !href) continue
    const latin = toLatinDigits(block)
    const price = latin.match(/([\d,]{6,})\s*تومان/)
    if (!price) continue
    const title = block.match(/(?:title|alt)="([^"]{4,80})"/)?.[1]
      || block.match(/<h\d[^>]*>([^<]{4,80})<\/h\d>/)?.[1]
      || 'خودرو'
    const year = toLatinDigits(title).match(/\b(13[6-9]\d|14[01]\d)\b/)
    const image = /(?:data-src|src)="(https?:\/\/[^"]+\.(?:jpg|jpeg|png|webp))[^"]*"/.exec(block)?.[1] || null
    const freshness = latin.match(/(لحظاتی پیش|دقیقی پیش|\d+ دقیقه پیش|\d+ ساعت پیش|\d+ روز پیش|تازه)/)?.[1] || 'تازه'
    items.push({
      id: `sheypoor:${id}`,
      token: `sheypoor:${id}`,
      source: 'شیپور',
      title: title.trim(),
      year: year ? Number(year[1]) : 0,
      km: 0,
      color: '—',
      city: block.match(/class="[^"]*location[^"]*"[^>]*>([^<]{2,60})</)?.[1]?.trim() || 'نامشخص',
      price: faNumber(price[1]),
      freshness: relativeFreshness(freshness),
      link: `https://www.sheypoor.com${href}`,
      image,
    })
  }
  return items
}

export async function sheypoorListings({ category = 'light' } = {}) {
  const base = SHEYPOOR_CATEGORIES[category]
  if (!base) return { provider: 'sheypoor', category, items: [], note: 'UNSUPPORTED_CATEGORY' }
  try {
    const html = await fetchText(base)
    const items = parseSheypoorCards(html)
    return { provider: 'sheypoor', category, items, scope: `sheypoor:${category}`, totalAnalyzed: items.length }
  } catch (error) {
    return { provider: 'sheypoor', category, items: [], note: error.message }
  }
}
