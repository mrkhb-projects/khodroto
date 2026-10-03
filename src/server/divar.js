import fs from 'node:fs/promises'
import path from 'node:path'
import { analyzeListings } from './analyzer.js'

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

export function rankListings(items, options = {}) {
  return analyzeListings(items, { ...options, includeNoPhoto: options.includeNoPhoto ?? true }).items
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

/** Pull a mileage out of free text («کارکرد ۱۷۰٬۰۰۰ کیلومتر», «۱۷۰ هزار کیلومتر»). */
export function extractKmFromText(text = '') {
  const raw = String(text || '')
  const match = raw.match(/(?:کارکرد|کیلومتر\s*کارکرد)\s*[:：]?\s*([۰-۹0-9٬,\.]+\s*(?:هزار|میلیون)?)/)
    || raw.match(/([۰-۹0-9٬,\.]+\s*(?:هزار|میلیون)?)\s*(?:کیلومتر|کیلومتر کارکرد|km)/i)
  if (!match) return 0
  const parsed = parseMileage(match[1])
  // A bare "۱۴۰۰ کیلومتر" is far more likely to be a model year than a mileage.
  if (parsed.km >= 1300 && parsed.km <= 1415 && !/هزار|میلیون/.test(match[1])) return 0
  return parsed.known ? parsed.km : 0
}

function cleanFreshness(text = '') {
  const first = String(text || '').split(' · ')[0].trim()
  if (!first || /^(در|از)\s/.test(first)) return 'تازه'
  return first
}

function normalizeWebItem(widget) {
  const data = widget?.data || {}
  const payload = data.action?.payload || {}
  const webInfo = payload.web_info || {}
  const price = parseNumber(data.middle_description_text)
  const title = data.title || 'خودرو'
  return {
    id: data.token || payload.token,
    token: data.token || payload.token,
    title,
    year: extractYearFromText(title),
    // Cheap win before the detail fetch: many sellers put the mileage in the title
    // or the card's bottom line, and that costs us nothing to read.
    km: extractKmFromText(`${title} ${data.bottom_description_text || ''}`),
    color: '—',
    city: [webInfo.city_persian, webInfo.district_persian].filter(Boolean).join('، ') || 'دیوار',
    price,
    priceText: data.middle_description_text || (price ? String(price) : 'توافقی'),
    freshness: cleanFreshness(data.bottom_description_text),
    link: (data.token || payload.token) ? `https://divar.ir/v/${data.token || payload.token}` : 'https://divar.ir/s/tehran/car',
    image: data.image_url || null,
  }
}

function webHeaders(env = process.env) {
  return {
    accept: 'application/json, text/plain, */*',
    'accept-language': 'fa-IR,fa;q=0.9,en;q=0.8',
    'content-type': 'application/json',
    origin: 'https://divar.ir',
    referer: 'https://divar.ir/',
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    'x-render-type': 'CSR',
    'x-standard-divar-error': 'true',
    ...(env.DIVAR_RELAY_TOKEN ? { 'x-khodroto-relay-token': String(env.DIVAR_RELAY_TOKEN) } : {}),
  }
}

function webApiBase(env) {
  const configured = env.DIVAR_API_BASE_URL || WEB_BASE_URL
  try {
    const url = new URL(configured)
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('protocol')
    return url.origin
  } catch {
    throw new DivarUpstreamError('DIVAR_API_BASE_URL is invalid', { status: 500, provider: 'web', code: 'BAD_CONFIG' })
  }
}

const toLatinDigits = value => String(value ?? '').replace(/[۰-۹]/g, digit => '۰۱۲۳۴۵۶۷۸۹'.indexOf(digit))

export function extractYearFromText(text = '') {
  const raw = String(text || '')
  const latin = toLatinDigits(raw)
  let match = latin.match(/(?:مدل|سال)\s*(?:ساخت|تولید)?\s*(13\d{2}|14\d{2}|\d{2})(?!\d)/)
  if (!match) match = latin.match(/(?:^|\D)(13\d{2}|140\d)(?!\d)/)
  // Bare two-digit years are very common in Iranian car ads ("پرشیا ۹۱"). Only
  // accept them when normalizeVehicleYear can map them to a plausible build year.
  if (!match) match = latin.match(/(?:^|\D)(\d{2})(?!\d)/)
  if (!match) return 0
  return normalizeVehicleYear(match[1])
}

export function normalizeVehicleYear(value) {
  const year = Number(toLatinDigits(value))
  if (year >= 1300 && year <= 1415) return year
  if (year >= 50 && year <= 99) return 1300 + year
  if (year >= 0 && year <= 10) return 1400 + year
  return 0
}

// Mileage can be written as «۱۷۰٬۰۰۰ کیلومتر», «۱۷۰ هزار کیلومتر», «170000 کیلومتر»
// or «صفر». parseNumber alone mis-reads the «هزار» form by a factor of 1000 and
// returns 0 for «صفر», which is indistinguishable from "unknown" downstream — so
// mileage gets its own parser that reports whether it actually found a value.
export function parseMileage(value) {
  const raw = String(value ?? '').trim()
  if (!raw) return { km: 0, known: false }
  const latin = toLatinDigits(raw).replace(/[٬,]/g, '')
  const match = latin.match(/(\d+(?:\.\d+)?)/)
  // «صفر کیلومتر» is a brand-new car: a KNOWN zero, which must not be confused with
  // "no mileage recorded". Only trust the word when the text carries no digits at
  // all, otherwise «۱۷۰٬۰۰۰» would be misread by a stray zero.
  if (!match) return /صفر/.test(raw) ? { km: 0, known: true } : { km: 0, known: false }
  let km = Number(match[1])
  if (/هزار/.test(raw)) km *= 1000
  if (/میلیون/.test(raw)) km *= 1_000_000
  km = Math.round(km)
  if (!Number.isFinite(km) || km < 0 || km > 3_000_000) return { km: 0, known: false }
  return { km, known: true }
}

const MILEAGE_LABEL = /کارکرد|کیلومتر|مسافت پیموده/
const YEAR_LABEL = /سال\s*(ساخت|تولید)?|مدل\s*(خودرو)?|سال$/
const COLOR_LABEL = /رنگ/

// Divar has shipped several widget shapes for the spec table over the years, and a
// listing that uses a shape we do not read looks exactly like a listing with no
// mileage at all. Read every row-like widget instead of two hard-coded types.
function detailRows(widget) {
  const data = widget?.data || {}
  const type = String(widget?.widget_type || '')
  if (Array.isArray(data.items) && data.items.some(item => item && (item.title || item.value))) return data.items
  if (/ROW|TABLE|INFO|FEATURE/.test(type) && (data.title || data.value)) return [data]
  return []
}

function readDetailFields(detail) {
  const result = { title: '', image: null, year: 0, km: 0, kmKnown: false, color: '—' }
  for (const section of detail.sections || []) {
    for (const widget of section.widgets || []) {
      const data = widget.data || {}
      if (section.section_name === 'TITLE' && !result.title) result.title = data.title || ''
      if (section.section_name === 'IMAGE' && !result.image) result.image = data.items?.[0]?.image?.url || data.items?.[0]?.image?.thumbnail_url || null
      for (const field of detailRows(widget)) {
        // Some shapes carry the caption in `title`, others in `label`/`name`; the
        // value may equally live in `value` or `text`.
        const label = String(field.title ?? field.label ?? field.name ?? '')
        const value = field.value ?? field.text ?? field.subtitle ?? ''
        if (!label) continue
        if (MILEAGE_LABEL.test(label) && !result.kmKnown) {
          const mileage = parseMileage(value)
          if (mileage.known) { result.km = mileage.km; result.kmKnown = true }
        }
        if (YEAR_LABEL.test(label) && !result.year) {
          const year = normalizeVehicleYear(parseNumber(value))
          if (year) result.year = year
        }
        if (COLOR_LABEL.test(label) && result.color === '—' && value) result.color = String(value)
      }
    }
  }
  return result
}

/**
 * Find the business/showroom identity inside a Divar detail payload.
 *
 * WHY A DEEP SCAN
 * Seller reputation has been recorded against `item.sellerKey` since the platform
 * shipped, but nothing ever produced that field, so the table stayed empty and the
 * whole feature was dead code. Divar exposes the shop behind an ad in more than one
 * widget shape and has changed it before, so instead of hard-coding one path we
 * look for any business-ish identifier and take the first stable one.
 *
 * Returns null when the ad is from a private seller — which must stay the common
 * case. A reputation we cannot attribute is worse than no reputation at all.
 */
export function extractSellerIdentity(detail) {
  if (!detail || typeof detail !== 'object') return null
  const idKeys = /^(business_ref|business_slug|business_token|shop_slug|shop_id|business_id)$/i
  const nameKeys = /^(business_name|shop_name|brand_name)$/i
  let id = '', name = ''
  const walk = (node, depth = 0) => {
    if (!node || typeof node !== 'object' || depth > 8) return
    if (Array.isArray(node)) { for (const child of node) walk(child, depth + 1); return }
    for (const [key, value] of Object.entries(node)) {
      if (typeof value === 'string' && value.trim()) {
        if (!id && idKeys.test(key)) id = value.trim()
        if (!name && nameKeys.test(key)) name = value.trim()
      }
      // Nested business object: { business_data: { slug, name } }
      if (value && typeof value === 'object' && /business|shop/i.test(key)) {
        if (!id && typeof value.slug === 'string') id = value.slug.trim()
        if (!id && typeof value.id === 'string') id = value.id.trim()
        if (!name && typeof value.name === 'string') name = value.name.trim()
        if (!name && typeof value.title === 'string') name = value.title.trim()
      }
      walk(value, depth + 1)
    }
  }
  walk(detail)
  if (!id && !name) return null
  return { key: `divar-business:${(id || name).slice(0, 80)}`, name: name || id }
}

async function enrichWebItem(item, env, fetchImpl) {
  try {
    const detail = await jsonRequest(`${webApiBase(env)}/v8/posts-v2/web/${encodeURIComponent(item.token)}`, {
      method: 'GET', provider: 'web', headers: webHeaders(env),
    }, fetchImpl)
    const fields = readDetailFields(detail)
    const seller = extractSellerIdentity(detail)
    return {
      ...item,
      ...fields,
      title: fields.title || item.title,
      image: fields.image || item.image,
      // Never let an unread spec table wipe a value the search card already gave us.
      km: fields.kmKnown ? fields.km : (Number(item.km) || 0),
      year: fields.year || item.year || 0,
      color: fields.color !== '—' ? fields.color : (item.color || '—'),
      price: parseNumber(detail.webengage?.price) || item.price,
      ...(seller ? { sellerKey: seller.key, sellerName: seller.name } : {}),
      enriched: true,
    }
  } catch {
    return { ...item, enrichFailed: true }
  }
}

/**
 * Enrich many listings with their detail page (colour, mileage, exact build year).
 *
 * WHY THIS MATTERS
 * The search endpoint never returns colour or mileage, so before this the platform
 * had `color:'—'` and `km:0` on every car. That silently disabled per-colour
 * averages completely and made every mileage filter a no-op. Only 12 items used to
 * be enriched, and only AFTER scoring, so the baseline never saw the data at all.
 *
 * Enrichment is therefore now: bounded-concurrency, cached across runs (so coverage
 * accumulates cycle by cycle instead of re-fetching the same tokens), and applied
 * BEFORE the market is computed.
 */
export async function enrichListings(rows, {
  env = process.env,
  fetchImpl = fetch,
  limit = Number(env.DIVAR_ENRICH_LIMIT) || 200,
  concurrency = Math.max(1, Number(env.DIVAR_ENRICH_CONCURRENCY) || 4),
  delayMs = Number(env.DIVAR_ENRICH_DELAY_MS) || 120,
  cache = null,
} = {}) {
  const enriched = new Map()
  const pending = []

  for (const item of rows) {
    const cached = cache?.get?.(item.token)
    if (cached) { enriched.set(item.token, { ...item, ...cached }); continue }
    if (pending.length < limit) pending.push(item)
  }

  let index = 0
  let fetched = 0, failed = 0
  async function worker() {
    while (index < pending.length) {
      const item = pending[index++]
      const result = await enrichWebItem(item, env, fetchImpl)
      const gained = result.color !== item.color || result.km !== item.km || result.year !== item.year
      if (gained) fetched += 1; else failed += 1
      enriched.set(item.token, result)
      // Cache EVERY successful detail fetch, not only the ones that changed a field.
      // Previously an ad whose detail page added nothing was left uncached, so the
      // next cycle spent part of its fixed budget re-fetching exactly the same
      // tokens — the queue never advanced and most listings were never enriched at
      // all, which is why mileage stayed «نامشخص» site-wide.
      if (!result.enrichFailed) {
        cache?.set?.(item.token, { color: result.color, km: result.km, year: result.year, sellerKey: result.sellerKey || '', sellerName: result.sellerName || '' })
      }
      if (delayMs) await new Promise(resolve => setTimeout(resolve, delayMs))
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, pending.length) }, worker))

  const items = rows.map(item => enriched.get(item.token) || item)
  const withColor = items.filter(item => item.color && item.color !== '—').length
  const withKm = items.filter(item => Number(item.km) > 0).length
  return { items, stats: { requested: pending.length, fetched, failed, cached: rows.length - pending.length, withColor, withKm } }
}

function describeBody(body) {
  if (body == null) return ''
  const message = body.message
  if (typeof message === 'string' && message.trim()) return message.slice(0, 300)
  if (message && typeof message === 'object') return JSON.stringify(message).slice(0, 300)
  const serialized = JSON.stringify(body)
  return serialized && serialized !== '{}' ? serialized.slice(0, 300) : ''
}

async function jsonRequest(url, options, fetchImpl) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 9000)
  try {
    const { provider, ...requestOptions } = options
    const response = await fetchImpl(url, { ...requestOptions, signal: controller.signal })
    const body = await response.json().catch(() => ({}))
    if (!response.ok) {
      const detail = describeBody(body)
      throw new DivarUpstreamError(`Divar responded with HTTP ${response.status}${detail ? `: ${detail}` : ''}`, {
        status: response.status,
        provider: options.provider,
        code: response.status === 401 || response.status === 403 ? 'AUTH_FAILED' : response.status === 429 ? 'RATE_LIMITED' : 'UPSTREAM_ERROR',
      })
    }
    return body
  } catch (error) {
    if (error instanceof DivarUpstreamError) throw error
    const networkDetail = error.cause?.code || error.code || error.message || 'unknown network error'
    throw new DivarUpstreamError(error.name === 'AbortError' ? 'Divar request timed out after 9s' : `Could not reach Divar: ${networkDetail}`, { provider: options.provider })
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
  return { source: 'kenar', category: filters.category || env.DIVAR_CATEGORY || 'light', items: enriched, observedTokens: normalized.map(item => item.id), totalAnalyzed: normalized.length, fullSnapshot: false, updatedAt: new Date().toISOString() }
}

/**
 * A "budget" bounds a crawl so it can run inside a user's HTTP request.
 *
 * WHY THIS EXISTS
 * The first visitor after a cold start used to trigger an UNBOUNDED sweep: up to
 * 500 pages with a 450 ms delay between them (≈ 225 s of sleeping alone) plus up to
 * 200 detail fetches — all awaited inside their request. That is the two-minute
 * first search. The incremental early-stop could not help, because it needs tokens
 * we have already seen and on a cold database there are none.
 *
 * A foreground crawl therefore gets a few pages, no enrichment and a hard deadline;
 * the exhaustive crawl continues in the background and replaces the cache entry.
 */
export function foregroundBudget(env = process.env) {
  return {
    maxPages: Math.max(1, Number(env.DIVAR_FOREGROUND_MAX_PAGES) || 2),
    timeoutMs: Math.max(1000, Number(env.DIVAR_FOREGROUND_TIMEOUT_MS) || 8000),
    delayMs: Math.max(0, Number(env.DIVAR_FOREGROUND_DELAY_MS) || 0),
    enrichLimit: Math.max(0, Number(env.DIVAR_FOREGROUND_ENRICH ?? 0)),
  }
}

export async function fetchWebListings({ filters = {}, env = process.env, fetchImpl = fetch, detailCache = null, reference = null, knownTokens = null, budget = null } = {}) {
  const configuredCityIds = String(env.DIVAR_CITY_IDS || '1').split(',').map(value => value.trim()).filter(value => /^\d+$/.test(value))
  const cityIds = filters.cityIds?.length ? filters.cityIds : configuredCityIds
  const category = ['light','motorcycles','heavy','parts-accessories','vehicles-services'].includes(filters.category) ? filters.category : env.DIVAR_WEB_CATEGORY || env.DIVAR_CATEGORY || 'light'
  const formData = { category: { str: { value: category } } }
  const addRange = (key,min,max) => { if(min||max) formData[key]={number_range:{...(min?{minimum:Number(min)}:{}),...(max?{maximum:Number(max)}:{})}} }
  addRange('price',filters.minPrice,filters.maxPrice)
  addRange('production-year',filters.minYear,filters.maxYear)
  addRange('usage',null,filters.maxUsage)
  if(filters.gearbox) formData.gearbox={repeated_string:{value:[filters.gearbox]}}
  if(filters.body) formData.body_status={repeated_string:{value:[filters.body]}}
  if(filters.color) formData.color={repeated_string:{value:[filters.color]}}
  if(filters.seller) formData.business_type={repeated_string:{value:[filters.seller]}}
  const searchData = { form_data: { data: formData } }
  if (filters.queryText) searchData.query = filters.queryText
  const baseBody = {
    city_ids: cityIds.length ? cityIds : ['1'],
    search_data: searchData,
    disable_recommendation: false,
    current_tab_slug: 'default',
  }
  const requestedMaxPages = Number(filters.maxPages ?? env.DIVAR_MAX_PAGES ?? 0)
  const hardMaxPages = Math.max(1, Number(env.DIVAR_HARD_MAX_PAGES) || 500)
  const configuredMaxPages = requestedMaxPages > 0 ? Math.min(requestedMaxPages, hardMaxPages) : hardMaxPages
  const maxPages = budget?.maxPages ? Math.min(budget.maxPages, configuredMaxPages) : configuredMaxPages
  // `|| 450` would ignore an explicit 0, so an operator could never turn the
  // politeness delay off on a fast private relay. Parse it properly.
  const configuredDelay = Number(env.DIVAR_REQUEST_DELAY_MS)
  const requestDelay = budget
    ? Math.max(0, budget.delayMs ?? 0)
    : Math.max(0, Number.isFinite(configuredDelay) ? configuredDelay : 450)
  // Wall-clock guard: a slow upstream must not hold a visitor's request open.
  const deadline = budget?.timeoutMs ? Date.now() + budget.timeoutMs : 0
  let deadlineHit = false
  // --- incremental crawl ----------------------------------------------------
  // Divar returns newest-first. Once we hit a run of pages whose listings we have
  // all seen recently, everything further back is older still, so there is nothing
  // new to gain by paging on. Walking all 500 pages every cycle was the single
  // biggest reason a refresh took so long and hammered the upstream.
  // Guard rails: only for an unfiltered crawl, never on the first pages, and the
  // result is explicitly NOT a full snapshot so reconciliation cannot wrongly
  // deactivate the listings we chose not to re-read.
  const incrementalEnabled = env.DIVAR_INCREMENTAL !== 'false' && knownTokens && knownTokens.size > 0 && !filters.queryText
  const warmupPages = Math.max(1, Number(env.DIVAR_INCREMENTAL_WARMUP_PAGES) || 3)
  const stopAfterKnownPages = Math.max(1, Number(env.DIVAR_INCREMENTAL_STOP_PAGES) || 2)
  let consecutiveKnownPages = 0
  let stoppedEarly = false
  let newTokens = 0

  const rows = []
  const seen = new Set()
  let cursor = null
  let page = 1
  let pagesFetched = 0
  let hasNextPage = true

  while (hasNextPage && page <= maxPages) {
    if (deadline && Date.now() > deadline) { deadlineHit = true; stoppedEarly = true; break }
    const paginationData = cursor
      ? { '@type': 'type.googleapis.com/post_list.PaginationData', page, page_size: 60, ...cursor }
      : { '@type': 'type.googleapis.com/post_list.PaginationData', page: 1, page_size: 60 }
    const payload = await jsonRequest(`${webApiBase(env)}/v8/postlist/w/search`, {
      method: 'POST', provider: 'web', headers: webHeaders(env), body: JSON.stringify({ ...baseBody, pagination_data: paginationData }),
    }, fetchImpl)
    pagesFetched += 1
    let pageTotal = 0
    let pageNew = 0
    for (const widget of payload.list_widgets || []) {
      if (widget.widget_type !== 'POST_ROW') continue
      const item = normalizeWebItem(widget)
      if (!item.id) continue
      if (!(item.price || ['parts-accessories','vehicles-services'].includes(category))) continue
      if (seen.has(item.id)) continue
      seen.add(item.id)
      rows.push(item)
      pageTotal += 1
      if (!knownTokens?.has(item.id)) { pageNew += 1; newTokens += 1 }
    }

    if (incrementalEnabled && page > warmupPages) {
      // A page is "exhausted" when every listing on it was already in our database.
      if (pageTotal > 0 && pageNew === 0) consecutiveKnownPages += 1
      else consecutiveKnownPages = 0
      if (consecutiveKnownPages >= stopAfterKnownPages) { stoppedEarly = true; break }
    }

    const pagination = payload.pagination || {}
    hasNextPage = Boolean(pagination.has_next_page && pagination.data)
    if (!hasNextPage) break
    cursor = { ...pagination.data }
    for (const key of ['@type', 'search_uid', 'viewed_tokens']) delete cursor[key]
    page += 1
    if (requestDelay) await new Promise(resolve => setTimeout(resolve, requestDelay))
  }

  if (['parts-accessories','vehicles-services'].includes(category)) {
    const filteredRows=applyLocalFilters(rows,filters).filter(item=>item.image)
    const enriched=await Promise.all(filteredRows.slice(0,12).map(item=>enrichWebItem(item,env,fetchImpl)))
    const items=[...enriched,...filteredRows.slice(12)].map(item=>({...item,market:item.price||0,score:item.price?55:50,discount:0,sampleSize:filteredRows.length,label:item.price?'قیمت ثبت‌شده':'قیمت توافقی'}))
    return{source:'divar-web',category,scope:`web:${category}:${[...cityIds].sort().join(',')}`,items,observedTokens:rows.map(item=>item.id),totalAnalyzed:rows.length,excludedNoPhoto:rows.length-filteredRows.length,suspiciousCount:0,pagesFetched,truncated:hasNextPage,fullSnapshot:!hasNextPage&&!stoppedEarly&&!filters.queryText,updatedAt:new Date().toISOString()}
  }
  // Enrich FIRST so colour, mileage and the exact build year reach the market
  // baseline — not just the twelve cards that happened to rank highest.
  const filtered = applyLocalFilters(rows, filters)
  // A foreground crawl reads only what the detail cache already holds (limit 0), so
  // the visitor never waits on hundreds of detail fetches. The background crawl
  // that follows does the real enrichment work.
  const { items: detailed, stats: enrichStats } = await enrichListings(filtered, {
    env, fetchImpl, cache: detailCache,
    ...(budget ? { limit: budget.enrichLimit ?? 0 } : {}),
  })
  const finalAnalysis = analyzeListings(detailed, { category, includeNoPhoto: false, reference })
  const items = finalAnalysis.items
  const analysis = finalAnalysis
  if (filters.sort === 'cheap') items.sort((a,b)=>a.price-b.price)
  if (filters.sort === 'expensive') items.sort((a,b)=>b.price-a.price)
  return { source: 'divar-web', category, scope: `web:${category}:${[...cityIds].sort().join(',')}`, items, observedTokens: rows.map(item => item.id), totalAnalyzed: rows.length, excludedNoPhoto: analysis.excludedNoPhoto, suspiciousCount: finalAnalysis.suspiciousCount, rejectedCount: finalAnalysis.rejectedCount, reviewCount: finalAnalysis.reviewCount, enrichment: enrichStats, incremental: { enabled: Boolean(incrementalEnabled), stoppedEarly, newTokens, knownTokens: knownTokens?.size || 0 }, pagesFetched, truncated: hasNextPage, partial: Boolean(budget), deadlineHit, fullSnapshot: !budget && !hasNextPage && !stoppedEarly && !filters.queryText && !filters.minPrice && !filters.maxPrice && !filters.minYear && !filters.maxYear && !filters.maxUsage && !filters.gearbox && !filters.body && !filters.color && !filters.seller, updatedAt: new Date().toISOString() }
}

export async function discoverDivarVehicleCatalog({ env = process.env, fetchImpl = fetch } = {}) {
  const seeds = ['vehicles','cars','light','heavy','motorcycles','parts-accessories','vehicles-services']
  const categories = new Map(), brands = new Set(), models = new Map()
  const walk = (value, key = '') => {
    if (!value || typeof value !== 'object') return
    if (Array.isArray(value)) { for (const item of value) walk(item, key); return }
    const normalizedKey = String(key).toLowerCase()
    const label = String(value.title || value.name || value.display_value || '').trim()
    const optionValue = String(value.value || value.slug || '').trim()
    if (label && optionValue && /brand|برند/.test(normalizedKey)) brands.add(label)
    if (label && optionValue && /model|مدل/.test(normalizedKey)) {
      const brand = String(value.brand || value.parent || 'سایر').trim()
      if (!models.has(brand)) models.set(brand, new Set())
      models.get(brand).add(label)
    }
    for (const [childKey, child] of Object.entries(value)) walk(child, `${normalizedKey}.${childKey}`)
  }
  for (const slug of seeds) {
    const body = { city_ids:['1'], search_data:{form_data:{data:{category:{str:{value:slug}}}}}, pagination_data:{'@type':'type.googleapis.com/post_list.PaginationData',page:1,page_size:1} }
    try {
      const payload = await jsonRequest(`${webApiBase(env)}/v8/postlist/w/search`, { method:'POST', provider:'web', headers:webHeaders(env), body:JSON.stringify(body) }, fetchImpl)
      const crumb = payload?.seo_details?.bread_crumb || []
      for (const entry of crumb) {
        const category = entry?.search_data?.form_data?.data?.category?.str?.value
        if (category) categories.set(category,{slug:category,name:entry.name||category})
      }
      walk(payload)
      if (['light','heavy','motorcycles'].includes(slug)) {
        const filterPayload = await jsonRequest(`${webApiBase(env)}/v8/postlist/w/filters`, { method:'POST', provider:'web', headers:webHeaders(env), body:JSON.stringify({city_ids:['1'],search_data:{form_data:{data:{category:{str:{value:slug}}}}}}) }, fetchImpl)
        for (const widget of filterPayload?.page?.widget_list || []) {
          const data = widget?.data || {}, key = String(data?.field?.key || '')
          if (!/brand.?model/i.test(key)) continue
          for (const option of data.options || []) {
            const display = String(option.display || '').trim(), raw = String(option.value || '')
            if (!display) continue
            const parts = raw.split(/::|\||\//).map(value=>value.trim()).filter(Boolean)
            const brand = parts.length > 1 ? parts[0] : display.split(/\s+/).slice(0,2).join(' ')
            brands.add(brand)
            if (!models.has(brand)) models.set(brand,new Set())
            models.get(brand).add(display)
          }
        }
      }
    } catch (error) {
      if (slug === seeds[0]) throw error
    }
  }
  return { categories:[...categories.values()], brands:[...brands], models:[...models].map(([brand,items])=>({brand,models:[...items]})), syncedAt:new Date().toISOString(), source:'divar-web' }
}

export function createDivarService({ env = process.env, fetchImpl = fetch, cacheTtlMs = 10 * 60 * 1000, cacheFile = null, detailCache = null, getReference = () => null, getKnownTokens = () => null } = {}) {
  const cache = new Map()
  const inflight = new Map()
  let hydrated = false
  let writing = Promise.resolve()
  let lastSuccessAt = null
  let lastError = null
  // Every distinct filter combination a visitor submits becomes its own cache key,
  // and a stale entry is deliberately kept so the site can still answer when Divar
  // is unreachable. Without a ceiling the Map - and therefore the persisted JSON
  // file - grows forever and eventually fills the hosting quota, which silently
  // breaks the next FTP deploy. Keep the newest entries only.
  const positive = (value, fallback) => { const parsed = Number(value); return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback }
  const cacheMaxEntries = Math.floor(positive(env.DIVAR_CACHE_MAX_ENTRIES, 150))
  const cacheMaxAgeMs = positive(env.DIVAR_CACHE_MAX_AGE_HOURS, 72) * 3600000

  function pruneCache() {
    const oldest = Date.now() - cacheMaxAgeMs
    for (const [key, entry] of cache) if (!entry || !(entry.time > oldest)) cache.delete(key)
    if (cache.size <= cacheMaxEntries) return
    // Map preserves insertion order, not recency, so sort on the stored timestamp.
    const ranked = [...cache.entries()].sort((a, b) => (b[1]?.time || 0) - (a[1]?.time || 0))
    for (const [key] of ranked.slice(cacheMaxEntries)) cache.delete(key)
  }

  async function hydrateCache() {
    if (hydrated) return
    hydrated = true
    if (!cacheFile) return
    try {
      const stored = JSON.parse(await fs.readFile(cacheFile, 'utf8'))
      for (const [key, value] of stored.entries || []) if (value?.value?.items) cache.set(key, value)
      // An oversized file written by an older build is trimmed on first read.
      pruneCache()
    } catch (error) {
      if (error.code !== 'ENOENT') console.warn(`[divar:cache] Could not read cache: ${error.message}`)
    }
  }

  function persistCache() {
    // Prune before the persistence guard: the ceiling protects process memory
    // even when nothing is written to disk.
    pruneCache()
    if (!cacheFile) return
    writing = writing.then(async () => {
      await fs.mkdir(path.dirname(cacheFile), { recursive: true })
      const temporary = `${cacheFile}.tmp`
      await fs.writeFile(temporary, JSON.stringify({ version: 1, entries: [...cache.entries()] }))
      await fs.rename(temporary, cacheFile)
    }).catch(error => console.warn(`[divar:cache] Could not write cache: ${error.message}`))
  }
  const requestedProvider = String(env.DIVAR_PROVIDER || '').toLowerCase()
  const provider = requestedProvider === 'disabled' ? 'none' : requestedProvider === 'kenar' ? (env.KENAR_API_KEY ? 'kenar' : 'none') : env.KENAR_API_KEY && requestedProvider !== 'web' ? 'kenar' : 'web'

  async function refresh(filters = {}, { budget = null } = {}) {
    await hydrateCache()
    const key = JSON.stringify(filters)
    // Full and bounded crawls for the same filters must not share an inflight slot,
    // otherwise the quick one would be handed the slow one's promise and wait on it.
    const slot = budget ? `${key}|foreground` : key
    if (inflight.has(slot)) return inflight.get(slot)
    const request = (provider === 'kenar' ? fetchKenarListings({ filters, env, fetchImpl }) : provider === 'web' ? fetchWebListings({ filters, env, fetchImpl, detailCache, reference: getReference(), knownTokens: getKnownTokens(filters.category), budget }) : Promise.reject(new DivarUpstreamError('Divar integration is not configured', { status: 503, code: 'NOT_CONFIGURED' })))
      .then(value => { lastSuccessAt=new Date().toISOString();lastError=null;cache.set(key, { time: Date.now(), value }); persistCache(); return value })
      .catch(error=>{lastError={code:error.code||'UPSTREAM_ERROR',message:error.message,at:new Date().toISOString()};throw error})
      .finally(() => inflight.delete(slot))
    inflight.set(slot, request)
    return request
  }

  async function verifyListing(token) {
    if (!token || provider === 'none') return 'unknown'
    const url = provider === 'kenar'
      ? `${KENAR_BASE_URL}/v1/open-platform/finder/post/${encodeURIComponent(token)}`
      : `${webApiBase(env)}/v8/posts-v2/web/${encodeURIComponent(token)}`
    const headers = provider === 'kenar' ? { 'x-api-key': env.KENAR_API_KEY, accept: 'application/json' } : webHeaders(env)
    try {
      await jsonRequest(url, { method: 'GET', provider, headers }, fetchImpl)
      return 'active'
    } catch (error) {
      if (error instanceof DivarUpstreamError && [404, 410].includes(error.status)) return 'removed'
      return 'unknown'
    }
  }

  /**
   * @param foreground true when a visitor is waiting on this call. A foreground
   *        miss returns a small, fast slice and schedules the exhaustive crawl.
   */
  async function listings(filters = {}, { foreground = false } = {}) {
    await hydrateCache()
    const key = JSON.stringify(filters)
    const cached = cache.get(key)
    if (cached && Date.now() - cached.time < cacheTtlMs) return { ...cached.value, cached: true }
    if (cached) {
      // Stale-while-revalidate: answer instantly, refresh behind the scenes.
      refresh(filters).catch(() => {})
      return { ...cached.value, cached: true, stale: true }
    }
    if (!foreground) return refresh(filters)
    try {
      const quick = await refresh(filters, { budget: foregroundBudget(env) })
      backgroundRefresh(filters)
      return { ...quick, partial: true }
    } catch (error) {
      // A bounded attempt that fails should not strand the visitor on an error page
      // if the slow path can still answer; but neither should they wait minutes.
      backgroundRefresh(filters)
      throw error
    }
  }

  // Fire-and-forget full crawl. Errors are already recorded by refresh().
  function backgroundRefresh(filters) {
    const key = JSON.stringify(filters)
    if (inflight.has(key)) return
    refresh(filters).catch(() => {})
  }

  return {
    listings,
    refresh,
    verifyListing,
    status: () => ({ configured: provider !== 'none', connected: Boolean(lastSuccessAt), provider, official: provider === 'kenar', viaRelay: provider==='web'&&String(env.DIVAR_API_BASE_URL||WEB_BASE_URL).replace(/\/$/,'')!==WEB_BASE_URL, cacheTtlMinutes: cacheTtlMs / 60000, cachedSearches: cache.size, cacheLimit: cacheMaxEntries, refreshing: inflight.size > 0, lastSuccessAt, lastError }),
  }
}
