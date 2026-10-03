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
    km: 0,
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

function readDetailFields(detail) {
  const result = { title: '', image: null, year: 0, km: 0, color: '—' }
  for (const section of detail.sections || []) {
    for (const widget of section.widgets || []) {
      const data = widget.data || {}
      if (section.section_name === 'TITLE' && !result.title) result.title = data.title || ''
      if (section.section_name === 'IMAGE' && !result.image) result.image = data.items?.[0]?.image?.url || data.items?.[0]?.image?.thumbnail_url || null
      const fields = widget.widget_type === 'GROUP_INFO_ROW' ? data.items || [] : widget.widget_type === 'UNEXPANDABLE_ROW' ? [data] : []
      for (const field of fields) {
        const label = String(field.title || '')
        if (label.includes('کارکرد')) result.km = parseNumber(field.value)
        if (/سال|مدل/.test(label)) {
          const year = normalizeVehicleYear(parseNumber(field.value))
          if (year) result.year = year
        }
        if (label.includes('رنگ')) result.color = field.value || result.color
      }
    }
  }
  return result
}

async function enrichWebItem(item, env, fetchImpl) {
  try {
    const detail = await jsonRequest(`${webApiBase(env)}/v8/posts-v2/web/${encodeURIComponent(item.token)}`, {
      method: 'GET', provider: 'web', headers: webHeaders(env),
    }, fetchImpl)
    const fields = readDetailFields(detail)
    return { ...item, ...fields, title: fields.title || item.title, image: fields.image || item.image, price: parseNumber(detail.webengage?.price) || item.price }
  } catch {
    return item
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
      if (gained) {
        fetched += 1
        enriched.set(item.token, result)
        cache?.set?.(item.token, { color: result.color, km: result.km, year: result.year })
      } else {
        failed += 1
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

export async function fetchWebListings({ filters = {}, env = process.env, fetchImpl = fetch, detailCache = null, reference = null, knownTokens = null } = {}) {
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
  const requestedMaxPages = Number(env.DIVAR_MAX_PAGES ?? 0)
  const hardMaxPages = Math.max(1, Number(env.DIVAR_HARD_MAX_PAGES) || 500)
  const maxPages = requestedMaxPages > 0 ? Math.min(requestedMaxPages, hardMaxPages) : hardMaxPages
  const requestDelay = Math.max(0, Number(env.DIVAR_REQUEST_DELAY_MS) || 450)
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
  const { items: detailed, stats: enrichStats } = await enrichListings(filtered, { env, fetchImpl, cache: detailCache })
  const finalAnalysis = analyzeListings(detailed, { category, includeNoPhoto: false, reference })
  const items = finalAnalysis.items
  const analysis = finalAnalysis
  if (filters.sort === 'cheap') items.sort((a,b)=>a.price-b.price)
  if (filters.sort === 'expensive') items.sort((a,b)=>b.price-a.price)
  return { source: 'divar-web', category, scope: `web:${category}:${[...cityIds].sort().join(',')}`, items, observedTokens: rows.map(item => item.id), totalAnalyzed: rows.length, excludedNoPhoto: analysis.excludedNoPhoto, suspiciousCount: finalAnalysis.suspiciousCount, rejectedCount: finalAnalysis.rejectedCount, reviewCount: finalAnalysis.reviewCount, enrichment: enrichStats, incremental: { enabled: Boolean(incrementalEnabled), stoppedEarly, newTokens, knownTokens: knownTokens?.size || 0 }, pagesFetched, truncated: hasNextPage, fullSnapshot: !hasNextPage && !stoppedEarly && !filters.queryText && !filters.minPrice && !filters.maxPrice && !filters.minYear && !filters.maxYear && !filters.maxUsage && !filters.gearbox && !filters.body && !filters.color && !filters.seller, updatedAt: new Date().toISOString() }
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

  async function hydrateCache() {
    if (hydrated) return
    hydrated = true
    if (!cacheFile) return
    try {
      const stored = JSON.parse(await fs.readFile(cacheFile, 'utf8'))
      for (const [key, value] of stored.entries || []) if (value?.value?.items) cache.set(key, value)
    } catch (error) {
      if (error.code !== 'ENOENT') console.warn(`[divar:cache] Could not read cache: ${error.message}`)
    }
  }

  function persistCache() {
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

  async function refresh(filters = {}) {
    await hydrateCache()
    const key = JSON.stringify(filters)
    if (inflight.has(key)) return inflight.get(key)
    const request = (provider === 'kenar' ? fetchKenarListings({ filters, env, fetchImpl }) : provider === 'web' ? fetchWebListings({ filters, env, fetchImpl, detailCache, reference: getReference(), knownTokens: getKnownTokens(filters.category) }) : Promise.reject(new DivarUpstreamError('Divar integration is not configured', { status: 503, code: 'NOT_CONFIGURED' })))
      .then(value => { lastSuccessAt=new Date().toISOString();lastError=null;cache.set(key, { time: Date.now(), value }); persistCache(); return value })
      .catch(error=>{lastError={code:error.code||'UPSTREAM_ERROR',message:error.message,at:new Date().toISOString()};throw error})
      .finally(() => inflight.delete(key))
    inflight.set(key, request)
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

  async function listings(filters = {}) {
    await hydrateCache()
    const key = JSON.stringify(filters)
    const cached = cache.get(key)
    if (cached && Date.now() - cached.time < cacheTtlMs) return { ...cached.value, cached: true }
    if (cached) {
      refresh(filters).catch(() => {})
      return { ...cached.value, cached: true, stale: true }
    }
    return refresh(filters)
  }

  return {
    listings,
    refresh,
    verifyListing,
    status: () => ({ configured: provider !== 'none', connected: Boolean(lastSuccessAt), provider, official: provider === 'kenar', viaRelay: provider==='web'&&String(env.DIVAR_API_BASE_URL||WEB_BASE_URL).replace(/\/$/,'')!==WEB_BASE_URL, cacheTtlMinutes: cacheTtlMs / 60000, cachedSearches: cache.size, refreshing: inflight.size > 0, lastSuccessAt, lastError }),
  }
}
