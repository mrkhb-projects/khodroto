// Shared helpers for the additional listing providers (باما / شیپور / رینگ).
// Every provider collects *public* listing pages politely (no auth walls, no personal
// data) and maps them onto the same item schema the Divar provider produces, tagged
// with a `source` label so the UI can show where each listing comes from.
export const toLatinDigits = value => String(value ?? '').replace(/[۰-۹]/g, d => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d))

export const faNumber = value => {
  const latin = toLatinDigits(value).replace(/[٬,\s]/g, '')
  const match = latin.match(/\d+/)
  return match ? Number(match[0]) : 0
}

export const relativeFreshness = text => {
  const latin = toLatinDigits(text || '')
  if (/لحظ/.test(latin)) return 'لحظاتی پیش'
  const minutes = latin.match(/(\d[\d٬,]*)\s*دقیقه/)
  if (minutes) return `${faNumber(minutes[1])} دقیقه پیش`
  if (/دقایق|دقیق/.test(latin)) return 'دقایقی پیش'
  const hours = latin.match(/(\d[\d٬,]*)\s*ساعت/)
  if (hours || /ساعت/.test(latin)) return `${faNumber(hours?.[1] || 1)} ساعت پیش`
  const days = latin.match(/(\d[\d٬,]*)\s*روز/)
  if (days || /روز/.test(latin)) return `${faNumber(days?.[1] || 1)} روز پیش`
  const weeks = latin.match(/(\d[\d٬,]*)\s*هفته/)
  if (weeks || /هفته/.test(latin)) return `${faNumber(weeks?.[1] || 1)} هفته پیش`
  return 'تازه'
}

// Rough Gregorian→Jalali for foreign cars that bama lists with AD model years.
export const toJalaliYear = year => {
  const y = Number(year) || 0
  if (y >= 1300 && y <= 1415) return y
  if (y >= 1960 && y <= 2035) return y - 621
  return 0
}

export async function fetchText(url, { timeoutMs = 15000, headers = {} } = {}) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'user-agent': 'Khodroto Market Analyzer/1.0 (+https://bidup.ir; public listing aggregation)',
        accept: 'text/html,application/json;q=0.9,*/*;q=0.8',
        'accept-language': 'fa,en;q=0.5',
        ...headers,
      },
    })
    if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`)
    return await response.text()
  } finally {
    clearTimeout(timer)
  }
}

// Split SSR card anchors into text chunks so each provider can map its card fields.
export function cardChunks(html, anchorPattern) {
  const cards = []
  const regex = new RegExp(anchorPattern, 'g')
  let match
  const seen = new Set()
  while ((match = regex.exec(html))) {
    const href = match[1]
    if (seen.has(href)) continue
    seen.add(href)
    const end = html.indexOf('</a>', match.index)
    const stop = end > match.index ? end + 6 : match.index + 9000
    // Text chunks come only from inside THIS anchor; the look-behind slice is kept
    // separately (for image extraction) so a previous card never pollutes this one.
    const inner = html.slice(match.index, stop)
    const mediaSlice = html.slice(Math.max(0, match.index - 2500), stop)
    const chunks = [...inner.matchAll(/>([^<>{}\u200C]{1,80})</g)]
      .map(item => item[1].replace(/\s+/g, ' ').trim())
      .filter(text => text && !/^[12]\d{3}$/.test(text))
    cards.push({ href, chunks: [...new Set(chunks)], html: mediaSlice })
  }
  return cards
}
