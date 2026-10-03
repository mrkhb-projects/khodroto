import { describe, expect, it } from 'vitest'
import { createDivarService, extractYearFromText, fetchKenarListings, fetchWebListings, normalizeVehicleYear, parseNumber, rankListings } from '../src/server/divar.js'

describe('Divar integration', () => {
  it('parses Persian and Latin prices', () => {
    expect(parseNumber('۱٬۲۵۰٬۰۰۰٬۰۰۰ تومان')).toBe(1250000000)
    expect(parseNumber('980,000,000')).toBe(980000000)
  })

  it('ranks below-median listings without fabricated values', () => {
    const ranked = rankListings(
      [700, 750, 800, 850, 900, 950, 1000, 1050, 1100, 1150, 1200, 1250, 1300].map(price => ({ id: String(price), title: 'پژو ۲۰۷', price })),
    )
    const cheap = ranked.find(item => item.id === '800')
    const dear = ranked.find(item => item.id === '1300')
    expect(cheap.market).toBe(1000)
    expect(cheap.sampleSize).toBe(13)
    expect(cheap.score).toBeGreaterThan(dear.score)
  })

  it('treats an implausibly deep discount as a fraud signal, not as the best deal', () => {
    // 40% under a well-sampled cohort is not a bargain — the engine must flag it
    // instead of crowning it «فرصت عالی» the way the old scorer did.
    const ranked = rankListings(
      [...[700, 750, 800, 850, 900, 950, 1000, 1050, 1100, 1150, 1200, 1250, 1300], 600]
        .map((price, index) => ({ id: `r${index}`, title: 'پژو ۲۰۷', price })),
    )
    const bait = ranked.find(item => item.price === 600)
    expect(bait.suspicious).toBe(true)
    expect(bait.gateCodes).toContain('TOO_CHEAP')
    expect(ranked[0].price).not.toBe(600)
  })

  it('uses the official Kenar API and x-api-key', async () => {
    const calls = []
    const fetchImpl = async (url, options) => {
      calls.push({ url, options })
      // 13 comparables: the pricing engine refuses to publish a market value for a
      // cohort thinner than MIN_SAMPLES, so the fixture must look like a real market.
      if (options.method === 'POST') return { ok: true, json: async () => ({ posts:
        [700, 750, 800, 850, 900, 950, 1000, 1050, 1100, 1150, 1200, 1250, 1300].map((price, index) => ({
          token: `k-${index}`, title: 'پژو ۲۰۷', city: 'tehran', price: { value: String(price) }, vehicles_fields: { usage: '20000' },
        })) }) }
      return { ok: true, json: async () => ({ token: 'a', city: 'tehran', data: { color: 'سفید', production_year: 1402, images: ['https://example.com/car.jpg'] } }) }
    }
    const result = await fetchKenarListings({ env: { KENAR_API_KEY: 'secret', DIVAR_CITY: 'tehran' }, fetchImpl })
    expect(result.source).toBe('kenar')
    expect(result.items.find(item => item.price === 700).market).toBe(1000)
    expect(calls[0].url).toContain('/v2/open-platform/finder/post')
    expect(calls[0].options.headers['x-api-key']).toBe('secret')
  })

  it('uses Divar current public web endpoints without an API key', async () => {
    const calls = []
    const rows = [700, 750, 800, 850, 900, 950, 1000, 1050, 1100, 1150, 1200, 1250, 1300].map((price, index) => ({ widget_type: 'POST_ROW', data: {
      token: `token-${index}`, title: 'پژو ۲۰۷', middle_description_text: `${price} تومان`,
      bottom_description_text: 'لحظاتی پیش در تهران', image_url: 'https://example.com/car.webp',
      action: { payload: { token: `token-${index}`, web_info: { city_persian: 'تهران', district_persian: 'پونک' } } },
    } }))
    const fetchImpl = async (url, options) => {
      calls.push({ url, options })
      if (options.method === 'POST') return { ok: true, json: async () => ({ list_widgets: rows }) }
      return { ok: true, json: async () => ({ sections: [] }) }
    }
    const result = await fetchWebListings({ env: { DIVAR_CITY_IDS: '1', DIVAR_WEB_CATEGORY: 'light' }, fetchImpl })
    expect(result.source).toBe('divar-web')
    expect(result.items.find(item => item.price === 700)).toMatchObject({ market: 1000, city: 'تهران، پونک' })
    expect(calls[0].url).toBe('https://api.divar.ir/v8/postlist/w/search')
    const body = JSON.parse(calls[0].options.body)
    expect(body.city_ids).toEqual(['1'])
    expect(body.search_data.form_data.data.category.str.value).toBe('light')
    expect(calls.some(call => call.url.includes('/v8/posts-v2/web/token-0'))).toBe(true)
  })

  it('confirms a listing removed only on a 404 or 410 detail response', async () => {
    const fetchImpl = async () => ({ ok: false, status: 404, json: async () => ({}) })
    const service = createDivarService({ env: { DIVAR_PROVIDER: 'web' }, fetchImpl })
    expect(await service.verifyListing('deleted-token')).toBe('removed')
  })

  it('deduplicates and caches identical searches', async () => {
    let requests = 0
    const fetchImpl = async (_url, options) => {
      requests++
      if (options.method === 'POST') return { ok: true, json: async () => ({ posts: [] }) }
      return { ok: true, json: async () => ({}) }
    }
    const service = createDivarService({ env: { KENAR_API_KEY: 'secret' }, fetchImpl })
    await service.listings({ city: 'tehran' })
    const second = await service.listings({ city: 'tehran' })
    expect(second.cached).toBe(true)
    expect(requests).toBe(1)
  })

  it('caps the search cache so the persisted file cannot fill the disk', async () => {
    const fetchImpl = async (_url, options) => options.method === 'POST'
      ? { ok: true, json: async () => ({ posts: [] }) }
      : { ok: true, json: async () => ({}) }
    const service = createDivarService({
      env: { KENAR_API_KEY: 'secret', DIVAR_CACHE_MAX_ENTRIES: '5' },
      fetchImpl,
      cacheFile: null,
    })
    for (let index = 0; index < 20; index++) await service.listings({ city: `city-${index}` })
    const status = service.status()
    expect(status.cacheLimit).toBe(5)
    expect(status.cachedSearches).toBeLessThanOrEqual(5)
  })

  it('drops cache entries older than the configured maximum age', async () => {
    const fetchImpl = async (_url, options) => options.method === 'POST'
      ? { ok: true, json: async () => ({ posts: [] }) }
      : { ok: true, json: async () => ({}) }
    const service = createDivarService({
      env: { KENAR_API_KEY: 'secret', DIVAR_CACHE_MAX_AGE_HOURS: '0.0000001' },
      fetchImpl,
    })
    await service.listings({ city: 'tehran' })
    await new Promise(resolve => setTimeout(resolve, 5))
    await service.listings({ city: 'karaj' })
    expect(service.status().cachedSearches).toBe(1)
  })
})

describe('vehicle year extraction from listing titles', () => {
  it('extracts full and two-digit years from titles', () => {
    expect(extractYearFromText('کوییک s مدل 1401 بی رنگ سالم')).toBe(1401)
    expect(extractYearFromText('پرشیا دو گانه سوز ۹۱ سفید')).toBe(1391)
    expect(extractYearFromText('پژو ۲۰۷ اتوماتیک مدل ۹۹')).toBe(1399)
    expect(extractYearFromText('تیبا دو مدل ۱۴۰۰')).toBe(1400)
    expect(extractYearFromText('سمند LX مدل ۸۵')).toBe(1385)
    expect(extractYearFromText('اتوماتیک ۱۴۰۳')).toBe(1403)
  })

  it('does not mistake model numbers or prices for years', () => {
    expect(extractYearFromText('کوئیک s')).toBe(0)
    expect(extractYearFromText('پژو ۲۰۷ صفر کیلومتر')).toBe(0)
    expect(extractYearFromText('سمند فروش فوری')).toBe(0)
  })

  it('normalizes mixed digit shapes in normalizeVehicleYear', () => {
    expect(normalizeVehicleYear(1402)).toBe(1402)
    expect(normalizeVehicleYear('۹۹')).toBe(1399)
    expect(normalizeVehicleYear('08')).toBe(1408)
    expect(normalizeVehicleYear(2010)).toBe(0)
    expect(normalizeVehicleYear(45)).toBe(0)
  })
})
