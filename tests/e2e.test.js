// End-to-end tests.
//
// Everything else in this suite tests modules in isolation. These tests boot the
// REAL server as a child process against a throwaway database and talk to it over
// HTTP, so they catch the class of failure unit tests cannot: a broken route order,
// a bad import, a 404 on a page that is supposed to exist, or a server that does
// not start at all. That is exactly the failure that reached production before.

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createDatabase } from '../src/server/database.js'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const M = 1e6
let server
let baseUrl
let workdir

/** Seed a realistic market so the pages under test have something to show. */
function seedDatabase(file) {
  const store = createDatabase(file)
  const stamp = new Date().toISOString()
  let n = 0
  const insert = (title, priceM, year, color, category) => {
    const token = `e2e${++n}`
    const payload = { id: token, token, title, price: priceM * M, year, color, km: 90000, image: 'i.jpg', city: 'تهران', freshness: '۲ روز پیش', link: '#' }
    store.db.prepare("INSERT OR REPLACE INTO listings(token,title,city,price,market,score,payload,first_seen_at,last_seen_at,category,status) VALUES(?,?,?,?,0,0,?,?,?,?,'active')")
      .run(token, title, 'تهران', priceM * M, JSON.stringify(payload), stamp, stamp, category)
  }
  for (const price of [290, 295, 300, 305, 310, 298, 302, 308, 292, 306, 299, 301, 303, 297]) insert('پراید ۱۳۱ مدل ۱۳۹۰', price, 1390, 'سفید', 'light')
  for (const price of [920, 940, 950, 960, 970, 935, 955, 965, 945, 975, 930, 958, 948, 962]) insert('پژو ۲۰۷ اتوماتیک مدل ۱۴۰۱', price, 1401, 'سفید', 'light')
  for (const price of [700, 720, 740, 750, 760, 780, 800, 730, 770, 745, 755, 765]) insert('مینی بوس بنز ۳۰۲ مدل ۱۳۵۸', price, 1358, 'سفید', 'heavy')
  // A couple of price moves so the history sparkline has something to draw.
  store.db.prepare('INSERT OR IGNORE INTO price_history(token,price,recorded_at) VALUES(?,?,?)').run('e2e1', 320 * M, new Date(Date.now() - 6 * 86400000).toISOString())
  store.db.prepare('INSERT OR IGNORE INTO price_history(token,price,recorded_at) VALUES(?,?,?)').run('e2e1', 305 * M, new Date(Date.now() - 3 * 86400000).toISOString())
  store.db.prepare('INSERT OR IGNORE INTO price_history(token,price,recorded_at) VALUES(?,?,?)').run('e2e1', 290 * M, stamp)
  return n
}

async function waitForServer(url, { timeoutMs = 45000 } = {}) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (server?.exitCode !== null && server?.exitCode !== undefined) throw new Error(`server exited early with code ${server.exitCode}`)
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2500) })
      if (response.status < 500) return true
    } catch { /* not up yet */ }
    await new Promise(resolve => setTimeout(resolve, 300))
  }
  throw new Error('server did not become ready in time')
}

const get = (pathname, init) => fetch(`${baseUrl}${pathname}`, { signal: AbortSignal.timeout(20000), ...init })

beforeAll(async () => {
  // dist/ must exist: these tests also prove the built frontend is actually served.
  if (!fs.existsSync(path.join(projectRoot, 'dist', 'index.html'))) {
    throw new Error('dist/index.html is missing — run `npm run build` before the e2e suite')
  }
  workdir = fs.mkdtempSync(path.join(os.tmpdir(), 'khodroto-e2e-'))
  const dbFile = path.join(workdir, 'e2e.db')
  seedDatabase(dbFile)

  const port = 4000 + Math.floor(Math.random() * 1500)
  baseUrl = `http://127.0.0.1:${port}`
  server = spawn(process.execPath, ['server.js'], {
    cwd: projectRoot,
    env: {
      ...process.env,
      PORT: String(port),
      DATABASE_FILE: dbFile,
      DIVAR_CACHE_FILE: path.join(workdir, 'cache.json'),
      // Keep the test hermetic: no outbound calls to Divar or the price sites.
      DIVAR_PROVIDER: 'disabled',
      REFERENCE_ENABLED: 'false',
      RATE_LIMIT_DISABLED: 'true',
      NODE_ENV: 'test',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  server.stdout.on('data', () => {})
  server.stderr.on('data', () => {})
  await waitForServer(`${baseUrl}/api/health`)
}, 90000)

afterAll(() => {
  if (server && server.exitCode === null) server.kill('SIGTERM')
  if (workdir) fs.rmSync(workdir, { recursive: true, force: true })
})

describe('e2e · the server boots and serves the app', () => {
  it('serves the built single-page app at the root', async () => {
    const response = await get('/')
    expect(response.status).toBe(200)
    const html = await response.text()
    expect(html).toContain('<div id="root"></div>')
    expect(html).toMatch(/<script[^>]+src="[^"]+\.js"/)
  })

  it('serves the SPA shell for client-side routes', async () => {
    for (const route of ['/cars', '/compare', '/pricing']) {
      const response = await get(route)
      expect(response.status, route).toBe(200)
      expect((await response.text()), route).toContain('id="root"')
    }
  })
})

describe('e2e · the API surface answers', () => {
  // These are exactly the endpoints whose 404 proved the live server was stale.
  const endpoints = [
    ['/api/health', 200],
    ['/api/market/models?limit=3', 200],
    ['/api/market/baseline?limit=5', 200],
    ['/api/market/reference?limit=5', 200],
    ['/api/catalog/vehicles', 200],
    ['/api/locations/provinces', 200],
    ['/api/settings/public', 200],
    ['/api/seo/models', 200],
  ]
  it.each(endpoints)('GET %s → %i', async (endpoint, expected) => {
    const response = await get(endpoint)
    expect(response.status).toBe(expected)
    expect(response.headers.get('content-type')).toContain('application/json')
  })

  it('reports pipeline health with a problems list', async () => {
    const body = await (await get('/api/health')).json()
    expect(body).toHaveProperty('categories')
    expect(body).toHaveProperty('problems')
    expect(Array.isArray(body.problems)).toBe(true)
    const light = body.categories.find(entry => entry.category === 'light')
    expect(light.listings).toBeGreaterThan(20)
    expect(light.baselineRows).toBeGreaterThan(0)
  })

  it('prices each model against its own cohort, not one global median', async () => {
    const body = await (await get('/api/market/models?limit=20')).json()
    const pride = body.models.find(model => model.model.includes('پراید'))
    const peugeot = body.models.find(model => model.model.includes('۲۰۷'))
    expect(pride.median).toBeLessThan(400 * M)
    expect(peugeot.median).toBeGreaterThan(800 * M)
    expect(pride.median).not.toBe(peugeot.median)
  })

  it('keeps heavy vehicles out of the passenger-car market', async () => {
    const heavy = await (await get('/api/market/baseline?category=heavy&limit=20')).json()
    expect(heavy.rows.length).toBeGreaterThan(0)
    expect(heavy.rows.every(row => row.segment === 'heavy')).toBe(true)
  })

  it('estimates the value of a car the user describes', async () => {
    const response = await get(`/api/market/estimate?${new URLSearchParams({ title: 'پژو ۲۰۷ اتوماتیک', year: '1401', km: '70000' })}`)
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.ok).toBe(true)
    expect(body.estimate).toBeGreaterThan(700 * M)
    expect(body.range.low).toBeLessThan(body.estimate)
  })

  it('refuses to invent a price for an unknown model', async () => {
    const response = await get(`/api/market/estimate?${new URLSearchParams({ title: 'لامبورگینی اوراکان', year: '1402' })}`)
    expect(response.status).toBe(404)
    expect((await response.json()).ok).toBe(false)
  })

  it('returns a listing price history', async () => {
    const body = await (await get('/api/listings/e2e1/history')).json()
    expect(body.items.length).toBeGreaterThanOrEqual(3)
    expect(body.items[0]).toHaveProperty('price')
  })

  it('exposes a clean province→city directory with no districts', async () => {
    const body = await (await get('/api/catalog/vehicles')).json()
    const names = body.cities.map(city => city.name)
    expect(body.provinces).toHaveLength(31)
    expect(new Set(names).size).toBe(names.length)
    expect(names).not.toContain('کل ایران')
    expect(names).not.toContain('نیاوران')
  })

  it('protects admin routes', async () => {
    for (const route of ['/api/admin/market/rebuild', '/api/admin/alerts/run']) {
      const response = await get(route, { method: 'POST' })
      expect([401, 403], route).toContain(response.status)
    }
  })
})

describe('e2e · SEO', () => {
  it('lists crawlable model pages', async () => {
    const body = await (await get('/api/seo/models')).json()
    expect(body.count).toBeGreaterThan(0)
    expect(body.items[0]).toHaveProperty('slug')
  })

  it('renders a server-side price page with real numbers and structured data', async () => {
    const index = await (await get('/api/seo/models')).json()
    const page = index.items.find(item => item.label.includes('پراید')) || index.items[0]
    const response = await get(`/price/${encodeURIComponent(page.slug)}`)
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/html')
    const html = await response.text()
    expect(html).toContain(`قیمت ${page.label}`)
    expect(html).toContain('application/ld+json')
    expect(html).toContain('"@type":"AggregateOffer"')
    expect(html).toMatch(/<link rel="canonical" href="[^"]+\/price\//)
    expect(html).toContain('میلیون تومان')
    // The interactive app must still be present.
    expect(html).toContain('<div id="root"></div>')
  })

  it('falls back to the SPA for an unknown model slug', async () => {
    const response = await get('/price/یک-خودروی-ناموجود')
    expect(response.status).toBe(200)
    expect(await response.text()).not.toContain('application/ld+json')
  })

  it('publishes a sitemap that includes the model pages', async () => {
    const response = await get('/sitemap.xml')
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('xml')
    const xml = await response.text()
    expect(xml).toContain('<urlset')
    expect(xml).toContain('/price/')
    expect(xml).toContain('<loc>')
  })

  it('publishes robots.txt pointing at the sitemap', async () => {
    const text = await (await get('/robots.txt')).text()
    expect(text).toContain('Sitemap:')
    expect(text).toContain('Disallow: /api/')
  })
})

describe('e2e · admin operations surface', () => {
  it('guards every new endpoint behind the admin session', async () => {
    for (const route of ['/api/admin/health', '/api/admin/sellers', '/api/admin/reference/manual',
      '/api/admin/export/users', '/api/admin/export/listings', '/api/admin/export/subscriptions']) {
      expect((await get(route)).status, route).toBe(401)
    }
    expect((await get('/api/admin/reference/manual', { method: 'DELETE' })).status).toBe(401)
  })
})

describe('e2e · old admin surface still guarded', () => {
  it('still guards the pre-existing endpoints', async () => {
    expect((await get('/api/admin/users')).status).toBe(401)
    expect((await get('/api/admin/settings')).status).toBe(401)
  })
})

describe('e2e · scoring policy is configurable, not hard-coded', () => {
  it('publishes the band the operator configured', async () => {
    const data = await (await get('/api/listings?limit=3')).json()
    expect(data.visibilityBand).toMatchObject({ min: 15, max: 30 })
  })
})

describe('e2e · the free tier cap is enforced by the server', () => {
  // It used to live only in the UI, which politely asked for six results. A
  // visitor who typed ?limit=200 got the entire board and the subscription was
  // decorative.
  it('caps an anonymous request however large a limit it asks for', async () => {
    const response = await get('/api/listings?limit=200')
    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data.items.length).toBeLessThanOrEqual(6)
    // The true match count stays visible — that is what justifies upgrading.
    expect(data.totalMatches).toBeGreaterThan(data.items.length)
    expect(data.riskInsightsUnlocked).toBe(false)
  })

  it('does not let paging reassemble the full list', async () => {
    const first = await (await get('/api/listings?limit=6&offset=0')).json()
    const deep = await (await get('/api/listings?limit=6&offset=60')).json()
    expect(deep.items.length).toBeGreaterThan(0)
    // A free viewer is pinned to the head of the ranking: paging is a paid
    // feature, and a moving window would otherwise collect more than the cap.
    expect(deep.items.map(item => item.id)).toEqual(first.items.map(item => item.id))
  })

  it('still withholds the forensic fields from a free viewer', async () => {
    const data = await (await get('/api/listings?limit=3')).json()
    for (const item of data.items) {
      expect(item).not.toHaveProperty('gateCodes')
      expect(item).not.toHaveProperty('dealerSignals')
      expect(item).not.toHaveProperty('riskFlags')
    }
  })
})

describe('e2e · price hub', () => {
  it('serves the hub that links the model pages together', async () => {
    const response = await get('/price')
    expect(response.status).toBe(200)
    const html = await response.text()
    expect(html).toContain('قیمت روز خودرو')
    expect(html).toContain('"@type":"ItemList"')
  })

  it('links from the hub to a real model page that renders', async () => {
    const html = await (await get('/price')).text()
    const match = html.match(/href="\/price\/([^"]+)"/)
    expect(match).toBeTruthy()
    const page = await get(`/price/${match[1]}`)
    expect(page.status).toBe(200)
    const body = await page.text()
    expect(body).toContain('"@type":"BreadcrumbList"')
    expect(body).toContain('"@type":"FAQPage"')
  })

  it('advertises the hub and the estimator in the sitemap', async () => {
    const xml = await (await get('/sitemap.xml')).text()
    expect(xml).toContain('/price</loc>')
    expect(xml).toContain('/estimate</loc>')
  })
})

describe('e2e · seller tools', () => {
  it('serves the value-estimate page', async () => {
    const response = await get('/estimate')
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/html')
  })

  it('estimates a car the seeded market knows', async () => {
    const response = await get('/api/market/estimate?title=' + encodeURIComponent('پژو ۲۰۷ اتوماتیک') + '&year=1401&km=80000')
    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data.ok).toBe(true)
    expect(data.estimate).toBeGreaterThan(0)
    expect(data.range.high).toBeGreaterThan(data.range.low)
  })

  it('says so plainly instead of guessing an unknown model', async () => {
    const response = await get('/api/market/estimate?title=' + encodeURIComponent('خودروی ناشناخته'))
    expect(response.status).toBe(404)
    const data = await response.json()
    expect(data.ok).toBe(false)
    expect(typeof data.message).toBe('string')
  })
})

describe('e2e · alerts require a signed-in user', () => {
  it('rejects anonymous reads and writes rather than leaking', async () => {
    expect((await get('/api/alerts')).status).toBe(401)
    const created = await get('/api/alerts', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'x', filters: {} }),
    })
    expect(created.status).toBe(401)
    expect((await get('/api/alerts/1', { method: 'DELETE' })).status).toBe(401)
  })
})

describe('e2e · resilience', () => {
  it('returns JSON errors, not HTML, for bad API input', async () => {
    const response = await get('/api/market/trend')
    expect(response.status).toBe(400)
    expect(response.headers.get('content-type')).toContain('application/json')
  })

  it('serves an unknown page without crashing', async () => {
    const response = await get('/this-route-does-not-exist')
    expect([200, 404]).toContain(response.status)
  })

  it('stays up after the whole suite', async () => {
    expect(server.exitCode).toBeNull()
    expect((await get('/api/health')).status).toBe(200)
  })
})

describe('e2e · SEO formatting details', () => {
  it('writes build years without a thousands separator', async () => {
    const index = await (await get('/api/seo/models')).json()
    const page = index.items.find(item => item.years > 0)
    const html = await (await get(`/price/${encodeURIComponent(page.slug)}`)).text()
    // «۱۳۹۰» is a year; «۱٬۳۹۰» would be a number and reads as a bug to a user.
    expect(html).not.toMatch(/مدل ۱٬/)
    // \d does not match Persian digits, so the class must be spelled out.
    expect(html).toMatch(/مدل ۱[۳۴][۰-۹][۰-۹]/)
  })
})
