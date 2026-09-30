const KENAR_BASE_URL = 'https://open-api.divar.ir'
const WEB_BASE_URL = 'https://api.divar.ir'

export class DivarUpstreamError extends Error {
  constructor(message, { status = 502, provider = 'unknown', code = 'UPSTREAM_ERROR' } = {}) {
    super(message)
    this.name = 'DivarUpstreamError'
    this.status = status
    this.provider = provider
    this.code = code
  }
}

export function parseNumber(value = '') {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0
  const normalized = String(value)
    .replace(/[۰-۹]/g, digit => '۰۱۲۳۴۵۶۷۸۹'.indexOf(digit))
    .replace(/[٬,]/g, '')
  return Number((normalized.match(/\d+/) || [''])[0]) || 0
}

const clamp = (value, min, max) => Math.min(max, Math.max(min, value))
const median = values => {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b)
  if (!sorted.length) return 0
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle] : Math.round((sorted[middle - 1] + sorted[middle]) / 2)
}

function cohortKey(title = '') {
  return title
    .replace(/[۰-۹0-9]+/g, ' ')
    .replace(/[^\p{L}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .join(' ')
    .toLowerCase()
}

export function rankListings(items) {
  const priced = items.filter(item => item.price > 0)
  const cityMedian = median(priced.map(item => item.price))
  const cohorts = new Map()
  for (const item of priced) {
    const key = cohortKey(item.title)
    if (!cohorts.has(key)) cohorts.set(key, [])
    cohorts.get(key).push(item.price)
  }

  return priced.map(item => {
    const comparable = cohorts.get(cohortKey(item.title)) || []
    const market = comparable.length >= 3 ? median(comparable) : cityMedian
    const discount = market ? ((market - item.price) / market) * 100 : 0
    const score = Math.round(clamp(50 + discount * 1.25, 0, 100))
    return { ...item, market, discount: Number(discount.toFixed(1)), score, sampleSize: comparable.length >= 3 ? comparable.length : priced.length }
  }).filter(item => item.discount <= 45).sort((a, b) => b.score - a.score)
}

function relativeFreshness(date) {
  const timestamp = Date.parse(date)
  if (!timestamp) return 'تازه'
  const minutes = Math.max(1, Math.floor((Date.now() - timestamp) / 60000))
  if (minutes < 60) return `${minutes} دقیقه پیش`
  const hours = Math.floor(minutes / 60)
  return hours < 24 ? `${hours} ساعت پیش` : `${Math.floor(hours / 24)} روز پیش`
}

function normalizeKenarSearchItem(post) {
  return {
    id: post.token,
    token: post.token,
    title: post.title || 'خودرو',
    year: 0,
    km: parseNumber(post.vehicles_fields?.usage),
    color: '—',
    city: post.city || 'دیوار',
    price: parseNumber(post.price?.value),
    freshness: relativeFreshness(post.last_modified_at),
    link: `https://divar.ir/v/${post.token}`,
    image: null,
  }
}

function normalizeWebItem(widget) {
  const data = widget?.data || {}
  const price = parseNumber(data.middle_description || data.bottom_description)
  return {
    id: data.token,
    token: data.token,
    title: data.title || 'خودرو',
    year: 0,
    km: 0,
    color: '—',
    city: data.top_description || 'دیوار',
    price,
    freshness: 'تازه',
    link: data.token ? `https://divar.ir/v/${data.token}` : 'https://divar.ir/s/tehran/car',
    image: data.image_url?.[0]?.src || data.image_url || null,
  }
}

async function jsonRequest(url, options, fetchImpl) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 9000)
  try {
    const response = await fetchImpl(url, { ...options, signal: controller.signal })
    const body = await response.json().catch(() => ({}))
    if (!response.ok) {
      throw new DivarUpstreamError(body?.message || `Divar responded with ${response.status}`, {
        status: response.status,
        provider: options.provider,
        code: response.status === 401 || response.status === 403 ? 'AUTH_FAILED' : response.status === 429 ? 'RATE_LIMITED' : 'UPSTREAM_ERROR',
      })
    }
    return body
  } catch (error) {
    if (error instanceof DivarUpstreamError) throw error
    throw new DivarUpstreamError(error.name === 'AbortError' ? 'Divar request timed out' : 'Could not reach Divar', { provider: options.provider })
  } finally {
    clearTimeout(timeout)
  }
}

function applyLocalFilters(items, filters = {}) {
  return items.filter(item =>
    (!filters.minPrice || item.price >= filters.minPrice) &&
    (!filters.maxPrice || item.price <= filters.maxPrice)
  )
}

function buildKenarQuery(filters = {}, env = process.env) {
  const query = {}
  if (filters.minYear || filters.maxYear) query.production_year = {
    ...(filters.minYear ? { min: Number(filters.minYear) } : {}),
    ...(filters.maxYear ? { max: Number(filters.maxYear) } : {}),
  }
  if (filters.maxUsage) query.usage = { max: Number(filters.maxUsage) }
  return {
    category: env.DIVAR_CATEGORY || 'light',
    city: filters.city || env.DIVAR_CITY || 'tehran',
    ...(filters.queryText ? { query_text: String(filters.queryText).slice(0, 128) } : {}),
    ...(Object.keys(query).length ? { query } : {}),
  }
}

async function enrichKenarItem(item, apiKey, fetchImpl) {
  try {
    const detail = await jsonRequest(`${KENAR_BASE_URL}/v1/open-platform/finder/post/${encodeURIComponent(item.token)}`, {
      method: 'GET', provider: 'kenar', headers: { 'x-api-key': apiKey, accept: 'application/json' },
    }, fetchImpl)
    const data = detail.data || {}
    return {
      ...item,
      title: data.title || data.prefilled_title || item.title,
      year: parseNumber(data.production_year || data.year),
      km: parseNumber(data.usage) || item.km,
      color: data.color || item.color,
      city: [detail.city, detail.district].filter(Boolean).join('، ') || item.city,
      image: Array.isArray(data.images) ? data.images[0] : item.image,
      price: parseNumber(data.price?.value) || item.price,
    }
  } catch {
    return item
  }
}

export async function fetchKenarListings({ filters = {}, env = process.env, fetchImpl = fetch } = {}) {
  const apiKey = env.KENAR_API_KEY
  if (!apiKey) throw new DivarUpstreamError('KENAR_API_KEY is not configured', { status: 503, provider: 'kenar', code: 'NOT_CONFIGURED' })
  const payload = await jsonRequest(`${KENAR_BASE_URL}/v2/open-platform/finder/post`, {
    method: 'POST', provider: 'kenar',
    headers: { 'content-type': 'application/json', accept: 'application/json', 'x-api-key': apiKey },
    body: JSON.stringify(buildKenarQuery(filters, env)),
  }, fetchImpl)
  const normalized = (payload.posts || []).map(normalizeKenarSearchItem).filter(item => item.id && item.price)
  const filtered = applyLocalFilters(normalized, filters)
  const ranked = rankListings(filtered)
  const selected = ranked.slice(0, 6)
  const enriched = await Promise.all(selected.map(item => enrichKenarItem(item, apiKey, fetchImpl)))
  return { source: 'kenar', items: enriched, totalAnalyzed: normalized.length, updatedAt: new Date().toISOString() }
}

export async function fetchWebListings({ filters = {}, env = process.env, fetchImpl = fetch } = {}) {
  if (env.DIVAR_ALLOW_UNOFFICIAL !== 'true') throw new DivarUpstreamError('Unofficial adapter is disabled', { status: 503, provider: 'web', code: 'NOT_CONFIGURED' })
  const city = filters.city || env.DIVAR_CITY || 'tehran'
  const payload = await jsonRequest(`${WEB_BASE_URL}/v8/web-search/${encodeURIComponent(city)}/car`, {
    method: 'POST', provider: 'web', headers: { 'content-type': 'application/json', accept: 'application/json', 'user-agent': 'Khodroto/1.0' },
    body: JSON.stringify({ page: 1, json_schema: { category: { value: 'car' }, cities: [city] } }),
  }, fetchImpl)
  const normalized = (payload.web_widgets?.post_list || []).map(normalizeWebItem).filter(item => item.id && item.price)
  return { source: 'divar-web', items: rankListings(applyLocalFilters(normalized, filters)).slice(0, 6), totalAnalyzed: normalized.length, updatedAt: new Date().toISOString() }
}

export function createDivarService({ env = process.env, fetchImpl = fetch, cacheTtlMs = 15 * 60 * 1000 } = {}) {
  const cache = new Map()
  const inflight = new Map()
  const provider = env.KENAR_API_KEY ? 'kenar' : env.DIVAR_ALLOW_UNOFFICIAL === 'true' ? 'web' : 'none'

  async function listings(filters = {}) {
    const key = JSON.stringify(filters)
    const cached = cache.get(key)
    if (cached && Date.now() - cached.time < cacheTtlMs) return { ...cached.value, cached: true }
    if (inflight.has(key)) return inflight.get(key)
    const request = (provider === 'kenar' ? fetchKenarListings({ filters, env, fetchImpl }) : provider === 'web' ? fetchWebListings({ filters, env, fetchImpl }) : Promise.reject(new DivarUpstreamError('Divar integration is not configured', { status: 503, code: 'NOT_CONFIGURED' })))
      .then(value => { cache.set(key, { time: Date.now(), value }); return value })
      .finally(() => inflight.delete(key))
    inflight.set(key, request)
    return request
  }

  return {
    listings,
    status: () => ({ configured: provider !== 'none', provider, official: provider === 'kenar', cacheTtlMinutes: cacheTtlMs / 60000 }),
  }
}
