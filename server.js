import express from 'express'
import { createServer as createViteServer } from 'vite'
import { fallbackCars } from './src/data.js'
import { createDivarService, DivarUpstreamError } from './src/server/divar.js'

const app = express()
const PORT = process.env.PORT || 5173
const cacheTtl = Math.max(5, Number(process.env.DIVAR_CACHE_TTL_MINUTES) || 15) * 60 * 1000
const divar = createDivarService({ cacheTtlMs: cacheTtl })

app.disable('x-powered-by')
app.use(express.json({ limit: '20kb' }))

function searchFilters(query) {
  const year = String(query.year || '')
  const normalizedYear = year.replace(/[۰-۹]/g, digit => '۰۱۲۳۴۵۶۷۸۹'.indexOf(digit))
  const years = normalizedYear.match(/\d{4}/g)?.map(Number) || []
  const budget = String(query.budget || '')
  return {
    city: /^[a-z0-9-]{2,40}$/.test(String(query.city || '')) ? String(query.city) : undefined,
    queryText: String(query.brand || '').trim().slice(0, 128) || undefined,
    minYear: year.includes('بالا') || years.length > 1 ? years[0] : undefined,
    maxYear: year.includes('پیش') ? years[0] : years[1],
    minPrice: budget.includes('بیشتر') ? 1_200_000_000 : budget.includes('۷۰۰') && budget.includes('۱.۲') ? 700_000_000 : undefined,
    maxPrice: budget.includes('تا ۷۰۰') ? 700_000_000 : budget.includes('۷۰۰') && budget.includes('۱.۲') ? 1_200_000_000 : undefined,
  }
}

function applyBudget(items, budget = '') {
  if (budget.includes('تا ۷۰۰')) return items.filter(item => item.price <= 700_000_000)
  if (budget.includes('۷۰۰') && budget.includes('۱.۲')) return items.filter(item => item.price >= 700_000_000 && item.price <= 1_200_000_000)
  if (budget.includes('بیشتر')) return items.filter(item => item.price >= 1_200_000_000)
  return items
}

app.get('/api/integration/status', (_req, res) => {
  const status = divar.status()
  res.json({ ...status, source: status.provider === 'kenar' ? 'Kenar-e-Divar' : status.provider === 'web' ? 'Divar public web endpoints' : 'disabled', documentation: status.provider === 'kenar' ? 'https://github.com/divar-ir/kenar-docs' : 'https://github.com/shojaee76-cmyk/divar-mcp' })
})

app.get('/api/listings', async (req, res) => {
  try {
    const result = await divar.listings(searchFilters(req.query))
    res.set('Cache-Control', 'private, max-age=60')
    res.json({ ...result, items: applyBudget(result.items, String(req.query.budget || '')), integration: divar.status() })
  } catch (error) {
    const known = error instanceof DivarUpstreamError
    console.warn(`[divar:${error.provider || 'none'}] ${error.code || 'ERROR'}: ${error.message}`)
    res.status(200).json({
      source: 'demo',
      items: applyBudget(fallbackCars, String(req.query.budget || '')),
      notice: known && error.code === 'NOT_CONFIGURED'
        ? 'برای فعال‌شدن داده زنده، کلید رسمی کنار دیوار باید در محیط سرور تنظیم شود.'
        : 'ارتباط با دیوار موقتاً برقرار نشد؛ داده نمونه نمایش داده می‌شود.',
      integration: { ...divar.status(), errorCode: error.code || 'UNKNOWN' },
    })
  }
})

const vite = await createViteServer({ server: { middlewareMode: true, allowedHosts: true }, appType: 'spa' })
app.use(vite.middlewares)
app.listen(PORT, '0.0.0.0', () => console.log(`Khodroto running on http://0.0.0.0:${PORT} · Divar provider: ${divar.status().provider}`))
