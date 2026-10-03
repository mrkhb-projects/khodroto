import { faNumber, fetchText, toLatinDigits } from './common.js'

// رینگ (ring.ir) — پلتفرم مزایدهٔ خودرو. صفحهٔ اصلی SPA است و داده‌ها از API داخلی می‌آیند.
// این provider بهترین تلاش را روی مسیرهای عمومی احتمالی انجام می‌دهد؛ اگر ساختار API تغییر
// کرده باشد یا آنتی‌بات فعال باشد، هشدار می‌دهد اما جریان اصلی را مختل نمی‌کند.
// برای فعال‌سازی پایدارتر: از IP ایران استفاده کنید و در صورت لزوم مسیر API دقیق را با
// RING_API_URL به‌روزرسانی کنید.
const RING_API_URL = process.env.RING_API_URL || 'https://ring.ir/api/v1/auctions?status=active&page=1'

function normalizeRingItem(row) {
  const price = faNumber(row.currentBid ?? row.price ?? row.basePrice ?? '')
  if (!price) return null
  const title = String(row.title || row.vehicle || row.car || '').trim() || 'خودرو (مزایده)'
  const yearMatch = toLatinDigits(title).match(/\b(13[6-9]\d|14[01]\d)\b/)
  const id = String(row.id || row.slug || row.code || `${title}-${price}`)
  return {
    id: `ring:${id}`,
    token: `ring:${id}`,
    source: 'رینگ',
    title: `${title} (مزایده آنلاین)`,
    year: yearMatch ? Number(yearMatch[1]) : 0,
    km: faNumber(row.mileage ?? row.odometer ?? ''),
    color: '—',
    city: String(row.city || 'نامشخص'),
    price,
    priceText: 'قیمت پایه/فعلی مزایده',
    freshness: 'در حال مزایده',
    link: row.url ? `https://ring.ir${row.url.startsWith('http') ? '' : ''}${row.url}` : `https://ring.ir/auctions/${id}`,
    image: typeof row.image === 'string' ? row.image : row.image?.url || null,
  }
}

export async function ringListings({ category = 'light' } = {}) {
  if (category !== 'light') return { provider: 'ring', category, items: [], note: 'UNSUPPORTED_CATEGORY' }
  try {
    const raw = await fetchText(RING_API_URL, { headers: { accept: 'application/json' } })
    let rows = []
    try {
      const data = JSON.parse(raw)
      rows = Array.isArray(data) ? data : data.items || data.results || data.data || []
    } catch {
      // HTML برگشت → URL پیش‌فرض دیگر معتبر نیست.
      return { provider: 'ring', category, items: [], note: 'RING_API_SHAPE_CHANGED — set RING_API_URL to the current auctions JSON endpoint' }
    }
    const items = rows.map(normalizeRingItem).filter(Boolean)
    return { provider: 'ring', category, items, scope: 'ring:mz', totalAnalyzed: items.length }
  } catch (error) {
    return { provider: 'ring', category, items: [], note: error.message }
  }
}
