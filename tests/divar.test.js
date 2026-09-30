import { describe, expect, it } from 'vitest'
import { createDivarService, fetchKenarListings, fetchWebListings, parseNumber, rankListings } from '../src/server/divar.js'

describe('Divar integration', () => {
  it('parses Persian and Latin prices', () => {
    expect(parseNumber('۱٬۲۵۰٬۰۰۰٬۰۰۰ تومان')).toBe(1250000000)
    expect(parseNumber('980,000,000')).toBe(980000000)
  })

  it('ranks below-median listings without fabricated values', () => {
    const ranked = rankListings([
      { id: '1', title: 'پژو ۲۰۷', price: 800 },
      { id: '2', title: 'پژو ۲۰۷', price: 1000 },
      { id: '3', title: 'پژو ۲۰۷', price: 1200 },
    ])
    expect(ranked[0]).toMatchObject({ id: '1', market: 1000, discount: 20, score: 75, sampleSize: 3 })
  })

  it('uses the official Kenar API and x-api-key', async () => {
    const calls = []
    const fetchImpl = async (url, options) => {
      calls.push({ url, options })
      if (options.method === 'POST') return { ok: true, json: async () => ({ posts: [
        { token: 'a', title: 'پژو ۲۰۷', city: 'tehran', price: { value: '800' }, vehicles_fields: { usage: '20000' } },
        { token: 'b', title: 'پژو ۲۰۷', city: 'tehran', price: { value: '1000' } },
        { token: 'c', title: 'پژو ۲۰۷', city: 'tehran', price: { value: '1200' } },
      ] }) }
      return { ok: true, json: async () => ({ token: 'a', city: 'tehran', data: { color: 'سفید', production_year: 1402, images: ['https://example.com/car.jpg'] } }) }
    }
    const result = await fetchKenarListings({ env: { KENAR_API_KEY: 'secret', DIVAR_CITY: 'tehran' }, fetchImpl })
    expect(result.source).toBe('kenar')
    expect(result.items[0].market).toBe(1000)
    expect(calls[0].url).toContain('/v2/open-platform/finder/post')
    expect(calls[0].options.headers['x-api-key']).toBe('secret')
  })

  it('uses Divar current public web endpoints without an API key', async () => {
    const calls = []
    const rows = [800, 1000, 1200].map((price, index) => ({ widget_type: 'POST_ROW', data: {
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
    expect(result.items[0]).toMatchObject({ price: 800, market: 1000, city: 'تهران، پونک' })
    expect(calls[0].url).toBe('https://api.divar.ir/v8/postlist/w/search')
    const body = JSON.parse(calls[0].options.body)
    expect(body.city_ids).toEqual(['1'])
    expect(body.search_data.form_data.data.category.str.value).toBe('light')
    expect(calls.some(call => call.url.includes('/v8/posts-v2/web/token-0'))).toBe(true)
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
})
