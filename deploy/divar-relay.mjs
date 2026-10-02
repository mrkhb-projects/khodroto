import express from 'express'
import crypto from 'node:crypto'

const app = express()
const port = Number(process.env.PORT || 8787)
const token = String(process.env.DIVAR_RELAY_TOKEN || '')
if (token.length < 24) throw new Error('DIVAR_RELAY_TOKEN must contain at least 24 characters')

app.disable('x-powered-by')
app.set('trust proxy', 1)
app.use(express.json({ limit: '512kb' }))
app.get('/health', (_req, res) => res.json({ ok: true, service: 'khodroto-divar-relay' }))

const safeEqual = (left, right) => {
  const a = Buffer.from(String(left || ''))
  const b = Buffer.from(String(right || ''))
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

app.use((req, res, next) => {
  if (!safeEqual(req.get('x-khodroto-relay-token'), token)) return res.status(403).json({ error: 'FORBIDDEN' })
  next()
})

const upstreamHeaders = {
  accept: 'application/json, text/plain, */*',
  'accept-language': 'fa-IR,fa;q=0.9,en;q=0.8',
  'content-type': 'application/json',
  origin: 'https://divar.ir',
  referer: 'https://divar.ir/',
  'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/131 Safari/537.36',
  'x-render-type': 'CSR',
  'x-standard-divar-error': 'true',
}

async function forward(req, res, target, options = {}) {
  try {
    const response = await fetch(target, { ...options, headers: upstreamHeaders, signal: AbortSignal.timeout(15000) })
    const body = await response.text()
    res.status(response.status).type(response.headers.get('content-type') || 'application/json').send(body)
  } catch (error) {
    res.status(502).json({ error: 'DIVAR_UPSTREAM_UNREACHABLE', message: error.name === 'TimeoutError' ? 'timeout' : 'connection failed' })
  }
}

app.post('/v8/postlist/w/search', (req, res) => forward(req, res, 'https://api.divar.ir/v8/postlist/w/search', {
  method: 'POST',
  body: JSON.stringify(req.body || {}),
}))

app.get('/v8/posts-v2/web/:token', (req, res) => {
  if (!/^[a-zA-Z0-9_-]{4,100}$/.test(req.params.token)) return res.status(400).json({ error: 'INVALID_TOKEN' })
  return forward(req, res, `https://api.divar.ir/v8/posts-v2/web/${encodeURIComponent(req.params.token)}`, { method: 'GET' })
})

app.use((_req, res) => res.status(404).json({ error: 'NOT_FOUND' }))

app.listen(port, '0.0.0.0', () => console.log(`Khodroto Divar relay listening on 0.0.0.0:${port}`))
