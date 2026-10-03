import { describe, expect, it } from 'vitest'
import { createDivarService, fetchWebListings, foregroundBudget } from '../src/server/divar.js'

// A Divar that always claims there is another page — exactly the shape that made a
// cold first search walk hundreds of pages inside the visitor's request.
function endlessDivar({ pageDelayMs = 0 } = {}) {
  const calls = { search: 0, detail: 0 }
  const row = (page, index) => ({
    widget_type: 'POST_ROW',
    data: {
      token: `p${page}-${index}`, title: 'پژو ۲۰۷', middle_description_text: `${900 + index} تومان`,
      bottom_description_text: 'لحظاتی پیش در تهران', image_url: 'https://example.com/car.webp',
      action: { payload: { token: `p${page}-${index}`, web_info: { city_persian: 'تهران' } } },
    },
  })
  const fetchImpl = async (url, options) => {
    if (options.method === 'POST') {
      calls.search += 1
      const page = calls.search
      if (pageDelayMs) await new Promise(resolve => setTimeout(resolve, pageDelayMs))
      return {
        ok: true,
        json: async () => ({
          list_widgets: Array.from({ length: 12 }, (_, index) => row(page, index)),
          pagination: { has_next_page: true, data: { page, last_post_date: String(page) } },
        }),
      }
    }
    calls.detail += 1
    return { ok: true, json: async () => ({ sections: [] }) }
  }
  return { fetchImpl, calls }
}

const env = { DIVAR_CITY_IDS: '1', DIVAR_WEB_CATEGORY: 'light', DIVAR_REQUEST_DELAY_MS: '0' }

describe('cold-start crawl budget', () => {
  it('defaults to a couple of pages and an eight-second ceiling', () => {
    expect(foregroundBudget({})).toMatchObject({ maxPages: 2, timeoutMs: 8000, enrichLimit: 0 })
  })

  it('stops after the budgeted number of pages instead of walking them all', async () => {
    const { fetchImpl, calls } = endlessDivar()
    const result = await fetchWebListings({ env, fetchImpl, budget: foregroundBudget({}) })
    expect(calls.search).toBe(2)
    expect(result.partial).toBe(true)
    expect(result.items.length).toBeGreaterThan(0)
  })

  it('skips detail enrichment, which is the other half of the wait', async () => {
    const { fetchImpl, calls } = endlessDivar()
    await fetchWebListings({ env, fetchImpl, budget: foregroundBudget({}) })
    expect(calls.detail).toBe(0)
  })

  it('abandons the crawl when the wall-clock deadline passes', async () => {
    const { fetchImpl, calls } = endlessDivar({ pageDelayMs: 40 })
    const budget = { maxPages: 50, timeoutMs: 80, delayMs: 0, enrichLimit: 0 }
    const started = Date.now()
    const result = await fetchWebListings({ env, fetchImpl, budget })
    expect(Date.now() - started).toBeLessThan(1500)
    expect(calls.search).toBeLessThan(50)
    expect(result.deadlineHit).toBe(true)
  })

  it('never reports a budgeted crawl as a full snapshot', async () => {
    const { fetchImpl } = endlessDivar()
    const result = await fetchWebListings({ env, fetchImpl, budget: foregroundBudget({}) })
    // fullSnapshot drives reconciliation; a partial sweep must never deactivate
    // the listings it simply chose not to read.
    expect(result.fullSnapshot).toBe(false)
  })

  it('still walks everything when no budget is given', async () => {
    const { fetchImpl, calls } = endlessDivar()
    await fetchWebListings({ env: { ...env, DIVAR_MAX_PAGES: '6' }, fetchImpl })
    expect(calls.search).toBe(6)
  })


  it('honours an admin-provided maxPages filter over the host default', async () => {
    const { fetchImpl, calls } = endlessDivar()
    await fetchWebListings({ env: { ...env, DIVAR_MAX_PAGES: '12' }, filters: { maxPages: 3 }, fetchImpl })
    expect(calls.search).toBe(3)
  })
})

describe('foreground requests versus background crawls', () => {
  const service = fetchImpl => createDivarService({
    env: { ...env, DIVAR_PROVIDER: 'web' }, fetchImpl, cacheTtlMs: 60_000, cacheFile: null,
  })

  it('answers a cold visitor from a bounded crawl, then keeps crawling behind them', async () => {
    const { fetchImpl, calls } = endlessDivar()
    const divar = service(fetchImpl)
    const result = await divar.listings({ category: 'light' }, { foreground: true })
    expect(result.partial).toBe(true)
    // The answer the visitor got was built from two pages, whatever the background
    // crawl has done by now.
    expect(result.pagesFetched).toBe(2)
    const duringRequest = calls.search
    // The exhaustive crawl was scheduled, not skipped.
    await new Promise(resolve => setTimeout(resolve, 60))
    expect(calls.search).toBeGreaterThan(duringRequest)
  })

  it('does not hand the quick request the slow crawl promise', async () => {
    const { fetchImpl } = endlessDivar({ pageDelayMs: 10 })
    const divar = service(fetchImpl)
    const slow = divar.listings({ category: 'light' })        // unbounded
    const quick = await divar.listings({ category: 'light' }, { foreground: true })
    expect(quick.partial).toBe(true)
    slow.catch(() => {})
  })
})
