import { describe, expect, it } from 'vitest'
import { buildModelPages, relatedModels, renderIndexBody, renderIndexPage, renderModelPage, renderSitemap } from '../src/server/seo.js'

const M = 1e6
const baselineRow = (label, brand, over = {}) => ({
  cohort_key: `light|سواری|${brand}|${label}`, label, brand, segment: 'light',
  year: 0, color: '', samples: 24, avg: 900 * M, median: 880 * M, min: 700 * M, max: 1100 * M,
  p25: 820 * M, p75: 960 * M, generated_at: '2026-09-30T08:00:00.000Z', ...over,
})
const yearRow = (label, brand, year) => baselineRow(label, brand, { year, samples: 11, median: 910 * M })

const rows = [
  baselineRow('پژو ۲۰۷', 'پژو'), yearRow('پژو ۲۰۷', 'پژو', 1401),
  baselineRow('پژو پارس', 'پژو'),
  baselineRow('کوییک', 'سایپا'),
]
const pages = buildModelPages(rows, { category: 'light' })
const shell = '<html><head><title>خودروتو</title><meta name="description" content="x"/></head><body><div id="root"></div></body></html>'

describe('model page hub', () => {
  it('builds a page per model from the baseline', () => {
    // Order is by sample count, and JS string sort on Persian is not alphabetical,
    // so compare as a set.
    expect(new Set(pages.map(page => page.label))).toEqual(new Set(['پژو ۲۰۷', 'پژو پارس', 'کوییک']))
  })

  it('lists every model, grouped by brand', () => {
    const body = renderIndexBody(pages, 'https://bidup.ir')
    expect(body).toContain('پژو')
    expect(body).toContain('سایپا')
    for (const page of pages) expect(body).toContain(`/price/${encodeURIComponent(page.slug)}`)
  })

  it('publishes an ItemList so the hub can earn a rich result', () => {
    const html = renderIndexPage(shell, pages, { origin: 'https://bidup.ir' })
    expect(html).toContain('"@type":"ItemList"')
    expect(html).toContain('<link rel="canonical" href="https://bidup.ir/price"/>')
    // The shell's own title must be replaced, never duplicated.
    expect(html.match(/<title>/g)).toHaveLength(1)
  })
})

describe('internal linking', () => {
  it('prefers other models from the same brand', () => {
    const peugeot = pages.find(page => page.label === 'پژو ۲۰۷')
    const related = relatedModels(peugeot, pages)
    expect(related[0].brand).toBe('پژو')
    expect(related.map(page => page.slug)).not.toContain(peugeot.slug)
  })

  it('puts those links on the rendered model page, so it is no longer an orphan', () => {
    const peugeot = pages.find(page => page.label === 'پژو ۲۰۷')
    const html = renderModelPage(shell, peugeot, { origin: 'https://bidup.ir', allPages: pages })
    expect(html).toContain('قیمت مدل‌های مرتبط')
    expect(html).toContain('/price/' + encodeURIComponent(pages.find(p => p.label === 'پژو پارس').slug))
    expect(html).toContain('/estimate')
  })

  it('still renders when it is the only model we know', () => {
    const only = buildModelPages([baselineRow('تک مدل', 'برند')], { category: 'light' })
    const html = renderModelPage(shell, only[0], { origin: 'https://bidup.ir', allPages: only })
    expect(html).not.toContain('قیمت مدل‌های مرتبط')
  })
})

describe('structured data', () => {
  const html = renderModelPage(shell, pages[0], { origin: 'https://bidup.ir', allPages: pages })

  it('adds a breadcrumb trail through the hub', () => {
    expect(html).toContain('"@type":"BreadcrumbList"')
    expect(html).toContain('https://bidup.ir/price')
  })

  it('answers the questions people actually search for', () => {
    expect(html).toContain('"@type":"FAQPage"')
    expect(html).toContain('چند است؟')
  })

  it('keeps the aggregate offer', () => {
    expect(html).toContain('"@type":"AggregateOffer"')
  })
})

describe('sitemap', () => {
  it('includes the hub and the estimator', () => {
    const xml = renderSitemap(pages, { origin: 'https://bidup.ir', staticPaths: ['/', '/price', '/estimate'] })
    expect(xml).toContain('<loc>https://bidup.ir/price</loc>')
    expect(xml).toContain('<loc>https://bidup.ir/estimate</loc>')
  })

  it('reports when a model page actually changed, not just today', () => {
    const xml = renderSitemap(pages, { origin: 'https://bidup.ir' })
    expect(xml).toContain('<lastmod>2026-09-30</lastmod>')
  })

  it('falls back to today when a page has no timestamp', () => {
    const undated = buildModelPages([baselineRow('بی تاریخ', 'برند', { generated_at: null })], { category: 'light' })
    const xml = renderSitemap(undated, { origin: 'https://bidup.ir' })
    expect(xml).toContain(`<lastmod>${new Date().toISOString().slice(0, 10)}</lastmod>`)
  })
})
