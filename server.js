import express from 'express'
import path from 'node:path'
import { fallbackCars } from './src/data.js'
import { createDivarService, DivarUpstreamError } from './src/server/divar.js'

const app = express()
const PORT = process.env.PORT || 5173
const cacheTtl = Math.max(5, Number(process.env.DIVAR_CACHE_TTL_MINUTES) || 10) * 60 * 1000
const divar = createDivarService({ cacheTtlMs: cacheTtl, cacheFile: process.env.DIVAR_CACHE_FILE || 'data/divar-cache.json' })

app.disable('x-powered-by')
app.use(express.json({ limit: '20kb' }))

function searchFilters(query) {
  const year = String(query.year || '')
  const normalizedYear = year.replace(/[۰-۹]/g, digit => '۰۱۲۳۴۵۶۷۸۹'.indexOf(digit))
  const years = normalizedYear.match(/\d{4}/g)?.map(Number) || []
  const budget = String(query.budget || '')
  const directNumber = value => /^\d+$/.test(String(value || '')) ? Number(value) : undefined
  const brand = String(query.brand || '').trim()
  const freeQuery = [query.model, query.query].map(value=>String(value||'').trim()).filter(Boolean).join(' ')
  return {
    city: /^[a-z0-9-]{1,40}$/.test(String(query.city || '')) ? String(query.city) : undefined,
    cityIds: /^\d+(,\d+)*$/.test(String(query.city || '')) ? String(query.city).split(',') : undefined,
    queryText: [brand && !brand.startsWith('همه') ? brand : '', freeQuery].filter(Boolean).join(' ').slice(0,128) || undefined,
    minYear: directNumber(query.minYear) || (year.includes('بالا') || years.length > 1 ? years[0] : undefined),
    maxYear: directNumber(query.maxYear) || (year.includes('پیش') ? years[0] : years[1]),
    maxUsage: directNumber(query.maxUsage),
    gearbox: String(query.gearbox || '').slice(0,30) || undefined,
    body: String(query.body || '').slice(0,30) || undefined,
    color: String(query.color || '').slice(0,30) || undefined,
    seller: String(query.seller || '').slice(0,30) || undefined,
    sort: ['score','newest','cheap','expensive'].includes(String(query.sort)) ? String(query.sort) : 'score',
    minPrice: directNumber(query.minPrice) || (budget.includes('بیشتر از ۲') ? 2_000_000_000 : budget.includes('۱.۲ تا ۲') ? 1_200_000_000 : budget.includes('۷۰۰') && budget.includes('۱.۲') ? 700_000_000 : undefined),
    maxPrice: directNumber(query.maxPrice) || (budget.includes('تا ۵۰۰') ? 500_000_000 : budget.includes('تا ۷۰۰') ? 700_000_000 : budget.includes('۱.۲ تا ۲') ? 2_000_000_000 : budget.includes('۷۰۰') && budget.includes('۱.۲') ? 1_200_000_000 : undefined),
  }
}

function applyBudget(items, budget = '') {
  if (budget.includes('تا ۵۰۰')) return items.filter(item => item.price <= 500_000_000)
  if (budget.includes('تا ۷۰۰')) return items.filter(item => item.price <= 700_000_000)
  if (budget.includes('۷۰۰') && budget.includes('۱.۲')) return items.filter(item => item.price >= 700_000_000 && item.price <= 1_200_000_000)
  if (budget.includes('۱.۲ تا ۲')) return items.filter(item => item.price >= 1_200_000_000 && item.price <= 2_000_000_000)
  if (budget.includes('بیشتر از ۲')) return items.filter(item => item.price >= 2_000_000_000)
  return items
}

app.get('/api/integration/status', (_req, res) => {
  const status = divar.status()
  res.json({ ...status, source: status.provider === 'kenar' ? 'Kenar-e-Divar' : status.provider === 'web' ? 'Divar public web endpoints' : 'disabled', documentation: status.provider === 'kenar' ? 'https://github.com/divar-ir/kenar-docs' : 'https://github.com/shojaee76-cmyk/divar-mcp' })
})

app.get('/api/listings', async (req, res) => {
  try {
    const result = await divar.listings(searchFilters(req.query))
    const filtered = applyBudget(result.items, String(req.query.budget || ''))
    const offset = Math.max(0, Number(req.query.offset) || 0)
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 6))
    res.set('Cache-Control', 'private, max-age=60')
    res.json({ ...result, items: filtered.slice(offset, offset + limit), totalMatches: filtered.length, offset, limit, integration: divar.status() })
  } catch (error) {
    const known = error instanceof DivarUpstreamError
    console.warn(`[divar:${error.provider || 'none'}] ${error.code || 'ERROR'}: ${error.message}`)
    res.status(200).json({
      source: 'demo',
      items: applyBudget(fallbackCars, String(req.query.budget || '')).slice(0, Math.min(200, Math.max(1, Number(req.query.limit) || 6))),
      totalMatches: applyBudget(fallbackCars, String(req.query.budget || '')).length,
      notice: known && error.code === 'NOT_CONFIGURED'
        ? 'برای فعال‌شدن داده زنده، کلید رسمی کنار دیوار باید در محیط سرور تنظیم شود.'
        : 'ارتباط با دیوار موقتاً برقرار نشد؛ داده نمونه نمایش داده می‌شود.',
      integration: { ...divar.status(), errorCode: error.code || 'UNKNOWN' },
    })
  }
})

// Warm the default market cache now and refresh it every ten minutes. A stale cache is
// served immediately while the next crawl runs in the background.
const warmMarketCache = () => divar.refresh({}).then(result => console.log(`[divar] cached ${result.totalAnalyzed || result.items.length} listings from ${result.pagesFetched || 1} pages`)).catch(error => console.warn(`[divar:warmup] ${error.code || 'ERROR'}: ${error.message}`))
warmMarketCache()
setInterval(warmMarketCache, cacheTtl).unref()

// Serve the compiled SPA directly. Avoiding Vite middleware keeps the preview on
// one unambiguous port; all client-side routes fall back to index.html.
const dist = path.resolve('dist')
app.use(express.static(dist, { maxAge: '1h', index: false, redirect: false }))
app.use((req, res, next) => req.method === 'GET' && req.accepts('html') ? res.sendFile(path.join(dist, 'index.html')) : next())
app.listen(PORT, '0.0.0.0', () => console.log(`Khodroto running on http://0.0.0.0:${PORT} · Divar provider: ${divar.status().provider}`))
