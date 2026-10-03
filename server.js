// MUST be first: fills process.env from the host's .env before any module below
// reads a flag off it (BAMA_ENABLED, RING_ENABLED, ADMIN_PASSWORD, …).
import './src/server/env.js'
import express from 'express'
import path from 'node:path'
import crypto from 'node:crypto'
import { fallbackCars } from './src/data.js'
import { createDivarService, discoverDivarVehicleCatalog, DivarUpstreamError } from './src/server/divar.js'
import { publicVehicleCatalog } from './src/server/catalog.js'
import { createDatabase } from './src/server/database.js'
import { canViewRiskInsights, listingForViewer } from './src/server/access.js'
import { analyzeListings, filterListingItems, summarizeMarket, buildPriceIndex, exportBaseline, DEFAULT_WINDOW_DAYS } from './src/server/analyzer.js'
import { provinces, citiesOf, groupedCities, nearestCity, resolveCity } from './src/server/locations.js'
import { collectReferencePrices, buildReferenceIndex, referenceStatuses, sourceCatalogue } from './src/server/reference/index.js'
import { providerCatalogue } from './src/server/providers/index.js'
import { visibilityBand } from './src/server/opportunity.js'
import { dedupeListings } from './src/server/dedupe.js'
import { estimateValue } from './src/server/estimate.js'
import { dispatchAlerts } from './src/server/alerts.js'
import { buildModelPages, renderModelPage, renderSitemap, renderRobots, slugify } from './src/server/seo.js'
import fs from 'node:fs'
import { collectExternalListings, providerStatuses } from './src/server/providers/index.js'

let referenceIndex = buildReferenceIndex([])
const app = express()

// Lightweight IP rate limiter for the public read APIs. Without it a single
// client can pull the whole database in a loop.
const rateBuckets = new Map()
function rateLimit({ windowMs = 60_000, max = 120 } = {}) {
  return (req, res, next) => {
    if (process.env.RATE_LIMIT_DISABLED === 'true') return next()
    const key = `${req.ip}|${req.path}`
    const now = Date.now()
    const bucket = rateBuckets.get(key)
    if (!bucket || now > bucket.resetAt) {
      rateBuckets.set(key, { count: 1, resetAt: now + windowMs })
      return next()
    }
    bucket.count += 1
    if (bucket.count > max) {
      res.set('Retry-After', String(Math.ceil((bucket.resetAt - now) / 1000)))
      return res.status(429).json({ error: 'RATE_LIMITED', message: 'تعداد درخواست‌ها بیش از حد مجاز است؛ کمی بعد دوباره تلاش کنید.' })
    }
    return next()
  }
}
// Keep the bucket map from growing without bound.
setInterval(() => { const now = Date.now(); for (const [key, bucket] of rateBuckets) if (now > bucket.resetAt) rateBuckets.delete(key) }, 120_000).unref()
const PORT = process.env.PORT || 5173
const cacheTtl = Math.max(5, Number(process.env.DIVAR_CACHE_TTL_MINUTES) || 10) * 60 * 1000
const store = createDatabase()
// detailCache makes colour/mileage enrichment cumulative across crawl cycles;
// getReference lets the crawl screen bait prices the moment they arrive.
const divar = createDivarService({
  cacheTtlMs: cacheTtl,
  cacheFile: process.env.DIVAR_CACHE_FILE || 'data/divar-cache.json',
  detailCache: store.detailCache,
  getReference: () => referenceIndex,
  getKnownTokens: category => { try { return store.knownTokens(category || 'light') } catch { return null } },
})
const cookieToken=req=>Object.fromEntries(String(req.headers.cookie||'').split(';').map(x=>x.trim().split('='))).khodroto_session
const requireUser=(req,res,next)=>{const user=store.userFromToken(cookieToken(req));if(!user)return res.status(401).json({error:'AUTH_REQUIRED'});req.user=user;next()}
const adminPreview=process.env.ADMIN_PREVIEW==='true'&&process.env.NODE_ENV!=='production'
const requireDealer=(req,res,next)=>{const user=store.userFromToken(cookieToken(req));if(!user)return res.status(401).json({error:'AUTH_REQUIRED'});const subscription=store.subscription(user.id),active=subscription?.plan==='dealer'&&subscription.status==='active'&&Date.parse(subscription.expires_at)>Date.now();if(!active&&user.role!=='admin')return res.status(403).json({error:'DEALER_PLAN_REQUIRED'});req.user=user;next()}
const adminOnly=(req,res,next)=>adminPreview?(req.user={id:0,name:'مدیر پیش‌نمایش',role:'admin'},next()):requireUser(req,res,()=>req.user.role==='admin'?next():res.status(403).json({error:'FORBIDDEN'}))
const contactAttempts=new Map()
const adminLoginAttempts=new Map()
const adminCookie=result=>`khodroto_session=${result.token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200${process.env.NODE_ENV==='production'?'; Secure':''}`
const safeEqual=(left,right)=>{const a=Buffer.from(String(left||'')),b=Buffer.from(String(right||''));return a.length===b.length&&crypto.timingSafeEqual(a,b)}

async function persistCrawl(result, { verifyMissing = true } = {}) {
  const category = result.category || 'light'
  const reconciliation = Boolean(result.fullSnapshot && !result.cached)
  store.storeCrawl(result, { category, scope: result.scope, reconcile: reconciliation })
  if (!reconciliation || !verifyMissing) return
  const candidates = store.verificationCandidates(category, 25)
  for (const candidate of candidates) {
    const state = await divar.verifyListing(candidate.token)
    if (state !== 'unknown') store.markListingVerification(candidate.token, state)
  }
}

let marketRefreshRunning=false
async function refreshConfiguredMarket(){
 if(marketRefreshRunning)return{running:true,total:0,pages:0,scopes:0}
 marketRefreshRunning=true
 try{
  const cityIds=publicVehicleCatalog(store.settings()).cities.map(city=>city.id)
  const categories=['light','heavy','motorcycles','parts-accessories','vehicles-services'],batchSize=Math.max(1,Number(process.env.DIVAR_CITY_BATCH_SIZE)||40)
  const cityBatches=Array.from({length:Math.ceil(cityIds.length/batchSize)},(_,index)=>cityIds.slice(index*batchSize,(index+1)*batchSize))
  let total=0,pages=0,scopes=0
  // Divar rejects multi-city batches that contain district ids ("multi-city does not
  // support districts"). Retry such batches city by city so one district never
  // poisons the whole batch.
  for(const category of categories)for(const batch of cityBatches){
    const queue=[[...batch]]
    while(queue.length){
      const ids=queue.shift()
      try{const result=await divar.refresh({category,cityIds:ids});await persistCrawl(result);total+=result.totalAnalyzed||result.items?.length||0;pages+=result.pagesFetched||1;scopes++}
      catch(error){
        if(ids.length>1&&(Number(error.status)===400||String(error.message||'').includes('districts'))){for(const id of ids)queue.push([id]);continue}
        console.warn(`[divar] skipping ${category} cities:${ids.join(',')} → ${error.code||'ERROR'}: ${error.message}`)
      }
    }
  }
  // Additional market sources (باما/شیپور/رینگ) — enabled via env flags. Failures are
  // logged, never fatal, so the Divar refresh is always the reliable backbone.
  for(const category of categories){
    const externalResults=await collectExternalListings({category,pages:3})
    for(const result of externalResults){
      if(!result.items?.length){if(result.note)console.warn(`[${result.provider||'external'}] ${category} → ${result.note}`);continue}
      store.storeCrawl({category,scope:result.scope||`${result.provider}:${category}`,items:result.items},{category})
      total+=result.items.length;scopes++
    }
  }
  // The crawl is only half the job: once fresh listings are stored we immediately
  // recompute the 30-day averages, so the site never scores against stale baselines.
  const baseline=rebuildMarketBaseline()
  // Fire-and-forget: a failing SMS provider must never break the crawl.
  runAlerts().catch(error=>console.warn(`[alerts] ${error.message}`))
  return{running:false,total,pages,scopes,cities:cityIds.length,categories:categories.length,baseline}
 }finally{marketRefreshRunning=false}
}

app.disable('x-powered-by')
app.set('trust proxy',1)
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
    category: ['light','motorcycles','heavy','parts-accessories','vehicles-services'].includes(String(query.category)) ? String(query.category) : 'light',
    suspiciousOnly: String(query.suspiciousOnly)==='true',
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

/**
 * Split a result set into what the visitor sees by default and what stays behind
 * the «آگهی‌های مشکوک و شرکتی» opt-in.
 *
 * `showHidden=true` (or `includeSuspicious=true`) is the visitor ticking the box.
 * The counts are always reported so the UI can say «۱۴ آگهی مشکوک پنهان شد».
 */
function applyVisibility(items, query = {}) {
  const asked = ['showHidden', 'includeSuspicious', 'includeDealers'].some(key => String(query[key]) === 'true')
  const hiddenCount = items.filter(item => item.hidden).length
  const dealerCount = items.filter(item => item.dealer).length
  return {
    items: asked ? items : items.filter(item => !item.hidden),
    hiddenCount,
    dealerCount,
    showingHidden: asked,
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

app.post('/api/admin/login',(req,res)=>{const key=req.ip||'unknown',stamp=Date.now(),recent=(adminLoginAttempts.get(key)||[]).filter(time=>stamp-time<15*60*1000);if(recent.length>=8)return res.status(429).json({error:'TOO_MANY_ATTEMPTS'});adminLoginAttempts.set(key,[...recent,stamp]);const configured=String(process.env.ADMIN_PASSWORD||'');if(configured.length<12)return res.status(503).json({error:'ADMIN_LOGIN_NOT_CONFIGURED'});if(!safeEqual(req.body?.password,configured))return res.status(401).json({error:'INVALID_CREDENTIALS'});const result=store.createAdminSession(process.env.ADMIN_PHONE);if(!result)return res.status(503).json({error:'ADMIN_PHONE_NOT_CONFIGURED'});adminLoginAttempts.delete(key);res.setHeader('Set-Cookie',adminCookie(result));res.json({user:result.user})})
app.get('/api/admin/session',(req,res)=>{const user=store.userFromToken(cookieToken(req));res.json({authenticated:Boolean(user?.role==='admin')})})
app.post('/api/auth/request-otp',(req,res)=>{const phone=String(req.body?.phone||'');if(!/^09\d{9}$/.test(phone))return res.status(400).json({error:'INVALID_PHONE'});const code=store.requestOtp(phone);res.json({ok:true,expiresIn:120,...(process.env.NODE_ENV==='production'?{}:{debugCode:code})})})
app.post('/api/auth/verify',(req,res)=>{const result=store.verifyOtp(String(req.body?.phone||''),String(req.body?.code||''));if(!result)return res.status(400).json({error:'INVALID_CODE'});res.setHeader('Set-Cookie',`khodroto_session=${result.token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000${process.env.NODE_ENV==='production'?'; Secure':''}`);res.json({user:result.user})})
app.get('/api/auth/me',(req,res)=>res.json({user:store.userFromToken(cookieToken(req))}))
app.post('/api/auth/logout',(req,res)=>{store.logout(cookieToken(req));res.setHeader('Set-Cookie','khodroto_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');res.json({ok:true})})
app.patch('/api/user',requireUser,(req,res)=>res.json({user:store.updateUser(req.user.id,{name:String(req.body.name||req.user.name).slice(0,80),city:String(req.body.city||req.user.city).slice(0,20)})}))
app.get('/api/alerts',requireUser,(req,res)=>res.json({items:store.alerts(req.user.id)}))
app.post('/api/alerts',requireUser,(req,res)=>{store.createAlert(req.user.id,{title:String(req.body.title||'هشدار خودرو').slice(0,100),filters:req.body.filters||{}});res.status(201).json({ok:true})})
app.patch('/api/alerts/:id',requireUser,(req,res)=>{store.toggleAlert(req.user.id,Number(req.params.id),Boolean(req.body.enabled));res.json({ok:true})})
app.post('/api/support',requireUser,(req,res)=>{store.createTicket(req.user.id,{subject:String(req.body.subject||'پشتیبانی').slice(0,100),message:String(req.body.message||'').slice(0,2000)});res.status(201).json({ok:true})})
app.post('/api/contact',(req,res)=>{const key=req.ip||'unknown',stamp=Date.now(),recent=(contactAttempts.get(key)||[]).filter(time=>stamp-time<600000);if(recent.length>=5)return res.status(429).json({error:'RATE_LIMITED'});const name=String(req.body?.name||'').trim().slice(0,80),contact=String(req.body?.contact||'').trim().slice(0,120),subject=String(req.body?.subject||'').trim().slice(0,100),message=String(req.body?.message||'').trim().slice(0,2000);if(name.length<2||contact.length<5||subject.length<2||message.length<10)return res.status(400).json({error:'INVALID_INPUT'});contactAttempts.set(key,[...recent,stamp]);store.createTicket(null,{subject:`${subject} — ${name}`,message:`راه ارتباطی: ${contact}\n\n${message}`});res.status(201).json({ok:true})})

app.get('/api/subscription',requireUser,(req,res)=>res.json({subscription:store.subscription(req.user.id)||null}))
app.post('/api/subscription/checkout',requireUser,(req,res)=>{const plan=String(req.body.plan||''),managed=store.plans(true).find(item=>item.id===plan&&item.price>0);if(!managed)return res.status(400).json({error:'INVALID_PLAN'});const gateways=store.integrations('payment').filter(item=>item.enabled&&item.hasSecret).map(({id,name,provider,priority})=>({id,name,provider,priority})),requested=Number(req.body.gatewayId),gateway=gateways.find(item=>item.id===requested)||gateways[0]||null;res.json({subscription:store.subscribe(req.user.id,plan,managed.price),mode:gateway||process.env.PAYMENT_GATEWAY?'gateway':'sandbox',gateway,gateways})})
app.get('/api/listings/:token/history',(req,res)=>res.json({items:store.listHistory(String(req.params.token))}))
app.get('/api/stats/public',(_req,res)=>{res.set('Cache-Control','public, max-age=60');res.json(store.publicStats())})
app.get('/api/content/slides',(_req,res)=>{res.set('Cache-Control','public, max-age=60');res.json({items:store.slides(true)})})
app.get('/api/catalog/vehicles',(_req,res)=>{res.set('Cache-Control','public, max-age=3600');res.json(publicVehicleCatalog(store.settings()))})
// --- Location directory -----------------------------------------------------
// Province-first selection: the user picks an استان, then a شهر. Both lists are
// curated and deduplicated, so «کل ایران» appears exactly once and never as a city.
app.get('/api/locations/provinces',(_req,res)=>{res.set('Cache-Control','public, max-age=86400');res.json({provinces:provinces()})})
app.get('/api/locations/cities',(req,res)=>{
 res.set('Cache-Control','public, max-age=86400')
 const province=String(req.query.province||'')
 res.json(province?{province,cities:citiesOf(province)}:{groups:groupedCities()})
})
// Browser geolocation → nearest supported city, so the site can open on the user's
// own market instead of defaulting everyone to Tehran.
app.get('/api/locations/resolve',(req,res)=>{
 const match=nearestCity(req.query.lat,req.query.lng)
 if(!match)return res.status(404).json({error:'OUT_OF_COVERAGE',message:'شهری در نزدیکی موقعیت شما پشتیبانی نمی‌شود؛ «کل ایران» انتخاب می‌ماند.'})
 res.json({city:match})
})
// Stored per-model / per-year / per-colour averages (the pricing knowledge base).
app.get('/api/market/baseline',(req,res)=>{
 const category=['light','motorcycles','heavy'].includes(String(req.query.category))?String(req.query.category):'light'
 const limit=Math.min(1000,Math.max(1,Number(req.query.limit)||200))
 res.set('Cache-Control','public, max-age=300')
 res.json({category,meta:store.baselineMeta(category),rows:store.baselineRows(category,limit)})
})
app.post('/api/admin/market/rebuild',adminOnly,(req,res)=>{
 try{const result=rebuildMarketBaseline();store.audit(req.user.id,'rebuild','market_baseline','all',{categories:result.length});res.json({ok:true,result})}
 catch(error){res.status(500).json({error:'BASELINE_REBUILD_FAILED',message:error.message})}
})
// Reference prices gathered from Iranian daily price authorities.
app.get('/api/market/reference',(req,res)=>{
 const limit=Math.min(5000,Math.max(1,Number(req.query.limit)||500))
 res.set('Cache-Control','public, max-age=120')
 res.json({meta:store.referenceMeta(),sources:referenceStatuses(),runs:store.referenceRuns(10),rows:store.referencePrices(limit)})
})
app.post('/api/admin/market/reference/refresh',adminOnly,async(req,res)=>{
 try{const result=await refreshReferencePrices();store.audit(req.user.id,'refresh','reference_prices','all',{rows:result.rows});res.json({ok:true,...result})}
 catch(error){res.status(502).json({error:'REFERENCE_REFRESH_FAILED',message:error.message})}
})
// --- Alert delivery ---------------------------------------------------------
// Saved alerts used to do nothing at all. Now every crawl cycle matches fresh,
// trusted opportunities against them and hands the message to the SMS provider.
async function sendAlertSms({ phone, text }) {
 const [provider] = store.activeIntegrations('sms')
 if (!provider || !provider.secret) return false
 const endpoint = provider.config?.endpoint
 if (!endpoint) return false
 try {
  const response = await fetch(endpoint, {
   method: 'POST',
   headers: { 'content-type': 'application/json', authorization: `Bearer ${provider.secret}` },
   body: JSON.stringify({ to: phone, text, from: provider.config?.sender || undefined }),
  })
  return response.ok
 } catch { return false }
}

export async function runAlerts() {
 try {
  const result = await dispatchAlerts({
   store,
   itemsFor: category => { try { return marketAnalysis(category).items } catch { return [] } },
   sendSms: sendAlertSms,
  })
  if (result.matched) console.log(`[alerts] ${result.matched} matches · ${result.sent} sent · ${result.queued} queued`)
  return result
 } catch (error) { console.warn(`[alerts] ${error.message}`); return { error: error.message } }
}

app.get('/api/alerts/history', requireUser, (req, res) => res.json({ items: store.alertHistory(req.user.id) }))
app.post('/api/admin/alerts/run', adminOnly, async (req, res) => {
 const result = await runAlerts()
 store.audit(req.user.id, 'run', 'alerts', 'manual', result)
 res.json({ ok: !result.error, ...result })
})

// --- SEO: a real, crawlable page per vehicle model --------------------------
// The data for «قیمت پراید ۱۳۱» already exists in market_baseline; before this it
// was invisible to search engines because every URL returned the same empty SPA
// shell. These routes render the numbers server-side.
const SEO_CATEGORIES = ['light', 'heavy', 'motorcycles']
const seoCache = { at: 0, pages: [], bySlug: new Map() }

function seoPages() {
 if (Date.now() - seoCache.at < 10 * 60 * 1000 && seoCache.pages.length) return seoCache
 const pages = []
 for (const category of SEO_CATEGORIES) {
  try { pages.push(...buildModelPages(store.baselineRows(category, 1000), { category })) } catch {}
 }
 seoCache.at = Date.now()
 seoCache.pages = pages
 seoCache.bySlug = new Map(pages.map(page => [page.slug, page]))
 return seoCache
}
const siteOrigin = () => (process.env.SITE_ORIGIN || 'https://bidup.ir').replace(/\/$/, '')

app.get('/price/:slug', rateLimit({ max: 120 }), (req, res, next) => {
 const { bySlug } = seoPages()
 const page = bySlug.get(slugify(decodeURIComponent(req.params.slug)))
 if (!page) return next()
 let shell
 try { shell = fs.readFileSync(path.join(dist, 'index.html'), 'utf8') } catch { return next() }
 res.set('Cache-Control', 'public, max-age=600')
 res.type('html').send(renderModelPage(shell, page, { origin: siteOrigin() }))
})

// Machine-readable index of every model page, handy for debugging and for the UI.
app.get('/api/seo/models', rateLimit({ max: 30 }), (_req, res) => {
 const { pages } = seoPages()
 res.json({ count: pages.length, items: pages.map(page => ({ slug: page.slug, label: page.label, category: page.category, samples: page.overall.samples, median: page.overall.median, years: page.years.length })) })
})

app.get('/sitemap.xml', (_req, res) => {
 const { pages } = seoPages()
 res.set('Cache-Control', 'public, max-age=3600').type('application/xml')
 res.send(renderSitemap(pages, { origin: siteOrigin(), staticPaths: ['/', '/cars', '/compare', '/methodology', '/pricing', '/faq', '/about'] }))
})

app.get('/robots.txt', (_req, res) => {
 const allow = store.settings().robots_index !== 'false'
 res.set('Cache-Control', 'public, max-age=3600').type('text/plain')
 res.send(renderRobots({ origin: siteOrigin(), allow }))
})

// --- Platform health --------------------------------------------------------
// One place that answers "is the pipeline actually working?" — previously you had
// to read raw JSON from several endpoints to find out the crawler was failing.
app.get('/api/health', rateLimit({ max: 60 }), (_req, res) => {
 const integration = divar.status()
 const categories = ['light', 'heavy', 'motorcycles'].map(category => {
  const meta = store.baselineMeta(category)
  let cohorts = 0, priced = 0, total = 0
  try {
   const analysis = marketAnalysis(category)
   total = analysis.items.length
   priced = analysis.items.filter(item => item.market > 0).length
   cohorts = analysis.summary.totalModels
  } catch {}
  return { category, listings: total, priced, pricedPercent: total ? Math.round((priced / total) * 100) : 0, cohorts, baselineRows: meta?.rows || 0, baselineAt: meta?.generated_at || null }
 })
 const detail = store.detailCache.stats()
 const reference = store.referenceMeta()
 const problems = []
 if (integration.lastError) problems.push({ level: 'error', area: 'crawler', message: integration.lastError.message, at: integration.lastError.at })
 if (!reference?.rows) problems.push({ level: 'warn', area: 'reference', message: 'هیچ قیمت مرجعی ذخیره نشده؛ تشخیص آگهی فیک ضعیف می‌شود.' })
 for (const entry of categories) {
  if (!entry.listings) problems.push({ level: 'error', area: `listings:${entry.category}`, message: `هیچ آگهی‌ای برای دستهٔ ${entry.category} ذخیره نشده است.` })
  else if (entry.pricedPercent < 40) problems.push({ level: 'warn', area: `pricing:${entry.category}`, message: `فقط ${entry.pricedPercent}٪ آگهی‌های این دسته قیمت‌گذاری شده‌اند.` })
 }
 if (detail?.total && detail.with_color / detail.total < 0.2) problems.push({ level: 'warn', area: 'enrichment', message: 'پوشش رنگ کمتر از ۲۰٪ است؛ میانگین بر اساس رنگ قابل اتکا نیست.' })
 res.json({
  ok: problems.every(problem => problem.level !== 'error'),
  checkedAt: new Date().toISOString(),
  integration: { provider: integration.provider, connected: integration.connected, lastSuccessAt: integration.lastSuccessAt, lastError: integration.lastError || null },
  categories,
  enrichment: { cachedDetails: detail?.total || 0, withColor: detail?.with_color || 0, withKm: detail?.with_km || 0, colorPercent: detail?.total ? Math.round((detail.with_color / detail.total) * 100) : 0 },
  reference: { ...reference, sources: referenceStatuses() },
  sources: { listings: providerCatalogue(), reference: sourceCatalogue() },
  windowDays: MARKET_WINDOW_DAYS,
  problems,
 })
})

// --- Value my car -----------------------------------------------------------
app.get('/api/market/estimate', rateLimit({ max: 60 }), (req, res) => {
 const category = ['light', 'motorcycles', 'heavy'].includes(String(req.query.category)) ? String(req.query.category) : 'light'
 let priceIndex = null
 try { priceIndex = marketAnalysis(category).priceIndex } catch {}
 const result = estimateValue({
  title: req.query.title, brand: req.query.brand, model: req.query.model,
  year: req.query.year, km: req.query.km, color: req.query.color, body: req.query.body, category,
 }, { priceIndex, reference: referenceIndex })
 res.set('Cache-Control', 'public, max-age=120')
 res.status(result.ok ? 200 : 404).json(result)
})

// --- Price trend for one cohort ---------------------------------------------
app.get('/api/market/trend', rateLimit({ max: 60 }), (req, res) => {
 const category = ['light', 'motorcycles', 'heavy'].includes(String(req.query.category)) ? String(req.query.category) : 'light'
 const cohortKey = String(req.query.cohort || '')
 if (!cohortKey) return res.status(400).json({ error: 'COHORT_REQUIRED' })
 const points = store.baselineTrend(category, cohortKey, { year: req.query.year || 0, color: req.query.color || '', days: Math.min(365, Number(req.query.days) || 90) })
 res.json({ category, cohortKey, points })
})

// --- Dealers whose prices do not hold up ------------------------------------
app.get('/api/market/sellers', rateLimit({ max: 30 }), (_req, res) => {
 res.json({ items: store.worstSellers(25) })
})

app.get('/api/plans',(_req,res)=>res.json({items:store.plans(true)}))
app.get('/api/payment/options',(_req,res)=>res.json({items:store.integrations('payment').filter(item=>item.enabled&&item.hasSecret).map(({id,name,provider,priority})=>({id,name,provider,priority}))}))
app.get('/api/settings/public',(_req,res)=>{const s=store.settings(),keys=['site_name','site_tagline','support_phone','support_email','maintenance_mode','card_golden','card_good','card_fair','card_expensive','card_suspicious','mobile_listing_mode','hero_ticker','hero_title','hero_description','section_slider','section_search','section_opportunities','section_campaign','section_method','section_score','section_faq','feature_comparison','feature_alerts','feature_pricing','score_golden_min','score_good_min','vehicle_categories','vehicle_brands','supported_cities','vehicle_colors','default_city','default_sort','enable_motorcycles','enable_heavy_vehicles','faq_content','faq_enabled','faq_home_count','header_links','footer_platform_links','footer_help_links','footer_description','copyright_text','public_font_scale','show_announcement','enable_motion','campaign_enabled','campaign_title','campaign_description','campaign_discount','campaign_cta','seo_title','seo_description','og_title','og_description','og_image'];res.json(Object.fromEntries(keys.map(key=>[key,s[key]])))})
app.get('/api/dealer/summary',requireDealer,(req,res)=>{const inventory=store.dealerInventory(req.user.id),leads=store.dealerLeads(req.user.id),investment=inventory.filter(item=>item.status!=='sold').reduce((sum,item)=>sum+item.buy_price,0),expected=inventory.filter(item=>item.status!=='sold').reduce((sum,item)=>sum+item.target_price,0);res.json({inventory,leads,metrics:{inventoryCount:inventory.length,available:inventory.filter(item=>item.status==='available').length,activeLeads:leads.filter(item=>!['won','lost'].includes(item.status)).length,investment,expectedProfit:Math.max(0,expected-investment)},market:store.publicStats()})})
app.post('/api/dealer/inventory',requireDealer,(req,res)=>{try{res.status(201).json({items:store.saveDealerInventory(req.user.id,req.body||{})})}catch{res.status(400).json({error:'INVALID_INVENTORY'})}})
app.patch('/api/dealer/inventory/:id',requireDealer,(req,res)=>{try{const items=store.saveDealerInventory(req.user.id,req.body||{},Number(req.params.id));if(!items)return res.status(404).json({error:'NOT_FOUND'});res.json({items})}catch{res.status(400).json({error:'INVALID_INVENTORY'})}})
app.delete('/api/dealer/inventory/:id',requireDealer,(req,res)=>{store.deleteDealerInventory(req.user.id,Number(req.params.id));res.json({ok:true})})
app.post('/api/dealer/leads',requireDealer,(req,res)=>{try{res.status(201).json({items:store.saveDealerLead(req.user.id,req.body||{})})}catch{res.status(400).json({error:'INVALID_LEAD'})}})
app.patch('/api/dealer/leads/:id',requireDealer,(req,res)=>{try{const items=store.saveDealerLead(req.user.id,req.body||{},Number(req.params.id));if(!items)return res.status(404).json({error:'NOT_FOUND'});res.json({items})}catch{res.status(400).json({error:'INVALID_LEAD'})}})
app.delete('/api/dealer/leads/:id',requireDealer,(req,res)=>{store.deleteDealerLead(req.user.id,Number(req.params.id));res.json({ok:true})})
app.get('/api/dealer/export.csv',requireDealer,(req,res)=>{const esc=value=>`"${String(value??'').replaceAll('"','""')}"`,rows=[['نوع','عنوان/نام','خودرو','سال','قیمت خرید/بودجه','قیمت هدف','وضعیت','تلفن'],...store.dealerInventory(req.user.id).map(item=>['موجودی',item.title,`${item.brand} ${item.model}`,item.year,item.buy_price,item.target_price,item.status,'']),...store.dealerLeads(req.user.id).map(item=>['مشتری',item.name,item.vehicle,'',item.budget,'',item.status,item.phone])];res.set({'content-type':'text/csv; charset=utf-8','content-disposition':'attachment; filename="khodroto-dealer.csv"'});res.send('\ufeff'+rows.map(row=>row.map(esc).join(',')).join('\n'))})

app.get('/api/admin/stats',adminOnly,(_req,res)=>res.json(store.stats()))
app.get('/api/admin/users',adminOnly,(_req,res)=>res.json({items:store.adminUsers()}))
app.patch('/api/admin/users/:id',adminOnly,(req,res)=>{const role=['user','admin'].includes(req.body.role)?req.body.role:'user';store.setUserRole(Number(req.params.id),role);store.audit(req.user.id,'update_role','user',req.params.id,{role});res.json({ok:true})})
app.get('/api/admin/subscriptions',adminOnly,(_req,res)=>res.json({items:store.adminSubscriptions()}))
app.patch('/api/admin/subscriptions/:id',adminOnly,(req,res)=>{const status=['active','expired','cancelled','pending'].includes(req.body.status)?req.body.status:'pending';store.setSubscriptionStatus(Number(req.params.id),status);store.audit(req.user.id,'update_status','subscription',req.params.id,{status});res.json({ok:true})})
app.get('/api/admin/tickets',adminOnly,(_req,res)=>res.json({items:store.adminTickets()}))
app.patch('/api/admin/tickets/:id',adminOnly,(req,res)=>{const status=['open','pending','closed'].includes(req.body.status)?req.body.status:'open';store.setTicketStatus(Number(req.params.id),status);store.audit(req.user.id,'update_status','ticket',req.params.id,{status});res.json({ok:true})})
app.get('/api/admin/listings',adminOnly,(_req,res)=>res.json({items:store.adminListings()}))
app.patch('/api/admin/listings/:token',adminOnly,(req,res)=>{const status=['active','stale','inactive','removed'].includes(req.body.status)?req.body.status:null;if(!status)return res.status(400).json({error:'INVALID_STATUS'});store.setListingStatus(String(req.params.token),status);store.audit(req.user.id,'update_status','listing',req.params.token,{status});res.json({ok:true})})
app.get('/api/admin/plans',adminOnly,(_req,res)=>res.json({items:store.plans()}))
app.patch('/api/admin/plans/:id',adminOnly,(req,res)=>{const items=store.savePlan(String(req.params.id),req.body||{});if(!items)return res.status(404).json({error:'NOT_FOUND'});store.audit(req.user.id,'update','plan',req.params.id);res.json({items})})
app.get('/api/admin/settings',adminOnly,(_req,res)=>res.json({settings:store.settings()}))
app.patch('/api/admin/settings',adminOnly,(req,res)=>{const settings=store.updateSettings(req.body||{});store.audit(req.user.id,'update','settings','general');res.json({settings})})
app.get('/api/admin/slides',adminOnly,(_req,res)=>res.json({items:store.slides()}))
app.post('/api/admin/slides',adminOnly,(req,res)=>{try{const items=store.saveSlide(req.body||{});store.audit(req.user.id,'create','slide','',{title:req.body?.title});res.status(201).json({items})}catch{res.status(400).json({error:'INVALID_SLIDE'})}})
app.patch('/api/admin/slides/:id',adminOnly,(req,res)=>{try{const items=store.saveSlide(req.body||{},Number(req.params.id));store.audit(req.user.id,'update','slide',req.params.id,{title:req.body?.title});res.json({items})}catch{res.status(400).json({error:'INVALID_SLIDE'})}})
app.delete('/api/admin/slides/:id',adminOnly,(req,res)=>{store.deleteSlide(Number(req.params.id));store.audit(req.user.id,'delete','slide',req.params.id);res.json({ok:true})})
app.get('/api/admin/audits',adminOnly,(_req,res)=>res.json({items:store.audits()}))
function integrationInput(body={},kind){const config=kind==='payment'?{merchantId:String(body.config?.merchantId||'').slice(0,200),callbackUrl:String(body.config?.callbackUrl||'').slice(0,500),endpoint:String(body.config?.endpoint||'').slice(0,500)}:{sender:String(body.config?.sender||'').slice(0,100),templateId:String(body.config?.templateId||'').slice(0,100),endpoint:String(body.config?.endpoint||'').slice(0,500)};return{name:String(body.name||'').slice(0,80),provider:String(body.provider||'custom').slice(0,50),secret:String(body.secret||'').slice(0,4000),enabled:body.enabled!==false,priority:Number.isFinite(Number(body.priority))?Number(body.priority):100,config}}
const integrationKind=req=>['payment','sms'].includes(req.params.kind)?req.params.kind:null
app.get('/api/admin/integrations/:kind',adminOnly,(req,res)=>{const kind=integrationKind(req);if(!kind)return res.status(400).json({error:'INVALID_KIND'});res.json({items:store.integrations(kind)})})
app.post('/api/admin/integrations/:kind',adminOnly,(req,res)=>{const kind=integrationKind(req);if(!kind)return res.status(400).json({error:'INVALID_KIND'});try{const items=store.saveIntegration(kind,integrationInput(req.body,kind));store.audit(req.user.id,'create',kind,'',{name:req.body?.name});res.status(201).json({items})}catch(error){res.status(error.code==='ENCRYPTION_KEY_REQUIRED'?503:400).json({error:error.code||'INVALID_INTEGRATION'})}})
app.patch('/api/admin/integrations/:kind/:id',adminOnly,(req,res)=>{const kind=integrationKind(req);if(!kind)return res.status(400).json({error:'INVALID_KIND'});try{const items=store.saveIntegration(kind,integrationInput(req.body,kind),Number(req.params.id));if(!items)return res.status(404).json({error:'NOT_FOUND'});store.audit(req.user.id,'update',kind,req.params.id,{name:req.body?.name});res.json({items})}catch(error){res.status(error.code==='ENCRYPTION_KEY_REQUIRED'?503:400).json({error:error.code||'INVALID_INTEGRATION'})}})
app.delete('/api/admin/integrations/:kind/:id',adminOnly,(req,res)=>{const kind=integrationKind(req);if(!kind)return res.status(400).json({error:'INVALID_KIND'});store.deleteIntegration(kind,Number(req.params.id));store.audit(req.user.id,'delete',kind,req.params.id);res.json({ok:true})})

app.post('/api/admin/catalog/sync',adminOnly,async(req,res)=>{try{const catalog=await discoverDivarVehicleCatalog();const values={catalog_synced_at:catalog.syncedAt};if(catalog.categories.length)values.vehicle_categories=catalog.categories.map(item=>`${item.slug} | ${item.name}`).join('\n');if(catalog.brands.length)values.vehicle_brands=catalog.brands.join('\n');if(catalog.models.length)values.vehicle_models=catalog.models.map(item=>`${item.brand} | ${item.models.join(',')}`).join('\n');store.updateSettings(values);store.audit(req.user.id,'sync','divar_catalog','vehicle',{categories:catalog.categories.length,brands:catalog.brands.length});res.json({...catalog,cities:publicVehicleCatalog(store.settings()).cities.length})}catch(error){res.status(error.status||502).json({error:error.code||'CATALOG_SYNC_FAILED',message:error.message})}})
app.post('/api/admin/crawler/refresh',adminOnly,async(req,res)=>{try{const result=await refreshConfiguredMarket();store.audit(req.user.id,'refresh','crawler','manual',result);res.json({ok:true,...result,source:divar.status().provider})}catch(error){const code=error.code||'CRAWLER_ERROR';res.status(error.status>=400&&error.status<600?error.status:502).json({error:code,message:code==='UPSTREAM_ERROR'?'سرور میزبان به شبکه دیوار دسترسی ندارد؛ اتصال ایران یا رله خصوصی را تنظیم کنید.':error.message,integration:divar.status()})}})

app.get('/api/integration/status', (_req, res) => {
  const status = divar.status()
  res.json({ ...status, source: status.provider === 'kenar' ? 'Kenar-e-Divar' : status.provider === 'web' ? 'Divar public web endpoints' : 'disabled', additionalSources: providerStatuses(), documentation: status.provider === 'kenar' ? 'https://github.com/divar-ir/kenar-docs' : 'https://github.com/shojaee76-cmyk/divar-mcp' })
})

// Re-score stored listings against the current market picture (per model/year/color
// averages) and memoize per database signature so repeat searches stay instant.
// --- Reference prices -------------------------------------------------------
// Daily market valuations from Iranian price authorities (همراه مکانیک، بازارخودرو).
// They are the independent yardstick the fraud screen uses, so a wall of fake
// «کوییک ۵۸۰ میلیون» ads can never redefine what a Quick is worth.
// (declared near the top so createDivarService can close over it)
function loadReferenceFromStore(){
 try{
  const rows=store.referencePrices()
  referenceIndex=buildReferenceIndex(rows)
  if(rows.length)console.log(`[reference] loaded ${rows.length} prices for ${referenceIndex.cohorts} models from cache`)
 }catch(error){console.warn(`[reference:load] ${error.message}`)}
 return referenceIndex
}
export async function refreshReferencePrices(){
 const {rows,report}=await collectReferencePrices()
 for(const entry of report){
  try{store.logReferenceRun(entry)}catch{}
  console.log(`[reference] ${entry.key}: ${entry.ok?`${entry.rows} prices`:`FAILED — ${entry.note}`} (${entry.ms}ms)`)
 }
 const bySource=new Map()
 for(const row of rows){if(!bySource.has(row.source))bySource.set(row.source,[]);bySource.get(row.source).push(row)}
 for(const [source,sourceRows] of bySource){
  try{store.replaceReferencePrices(source,sourceRows)}catch(error){console.warn(`[reference:save] ${source}: ${error.message}`)}
 }
 loadReferenceFromStore()
 marketAnalysisCache.clear()
 return{rows:rows.length,models:referenceIndex.cohorts,report}
}

const marketAnalysisCache=new Map()
const MARKET_WINDOW_DAYS=Math.max(7,Number(process.env.MARKET_WINDOW_DAYS)||DEFAULT_WINDOW_DAYS)

function marketAnalysis(category){
 const signature=store.listingsSignature(category)
 const cached=marketAnalysisCache.get(category)
 if(cached&&cached.signature===signature&&Date.now()-cached.stamp<120000)return cached
 // Step 1 — take ONLY the listings observed in the rolling window (default 30 days),
 // then collapse the same car posted on several sites so one dealer cannot weight
 // their own asking price two or three times.
 const raw=store.recentPayloads(category,MARKET_WINDOW_DAYS)
 const {items:payloads,stats:dedupeStats}=dedupeListings(raw,{categoryHint:category})
 if(dedupeStats.removed)console.log(`[dedupe] ${category}: merged ${dedupeStats.removed} duplicate listings (${dedupeStats.input} → ${dedupeStats.output})`)
 // Step 2 — build one price index and reuse it for both scoring and the summary,
 // so a listing is always judged against exactly the averages we publish.
 const priceIndex=buildPriceIndex(payloads,{categoryHint:category,windowDays:MARKET_WINDOW_DAYS,reference:referenceIndex})
 const analysis=analyzeListings(payloads,{category,includeNoPhoto:true,windowDays:MARKET_WINDOW_DAYS,priceIndex,reference:referenceIndex})
 const items=analysis.items
 if(priceIndex.stats?.rejected||priceIndex.stats?.review)console.log(`[screen] ${category}: ${priceIndex.stats.rejected} rejected, ${priceIndex.stats.review} needs-review of ${priceIndex.stats.screened} listings`)
 const summary=summarizeMarket(payloads,{category,windowDays:MARKET_WINDOW_DAYS})
 const byModel=new Map(summary.models.map(model=>[model.model,model]))
 const entry={signature,stamp:Date.now(),items,summary,byModel,priceIndex,dedupe:dedupeStats}
 try{recordSellerReputation(items)}catch(error){console.warn(`[sellers] ${error.message}`)}
 marketAnalysisCache.set(category,entry)
 return entry
}

// Aggregate how trustworthy each seller's prices are. A dealer whose listings are
// repeatedly rejected by the fraud screen becomes visible instead of anonymous.
function recordSellerReputation(items){
 const buckets=new Map()
 for(const item of items){
  const key=item.sellerKey||item.source||(item.freshness==='نمایشگاه'?`dealer:${item.city||'?'}`:null)
  if(!key)continue
  if(!buckets.has(key))buckets.set(key,{key,label:item.source||item.city||key,listings:0,rejected:0,review:0,ratios:[]})
  const bucket=buckets.get(key)
  bucket.listings+=1
  if(item.trust==='reject')bucket.rejected+=1
  else if(item.trust==='review')bucket.review+=1
  if(item.referenceRatio)bucket.ratios.push(item.referenceRatio)
 }
 const rows=[...buckets.values()].filter(bucket=>bucket.listings>=3).map(bucket=>({
  ...bucket,
  avgRatio:bucket.ratios.length?Number((bucket.ratios.reduce((sum,value)=>sum+value,0)/bucket.ratios.length).toFixed(3)):null,
 }))
 if(rows.length)store.recordSellerStats(rows)
 return rows.length
}

// Step 3 — persist the averages per model / build year / colour so they survive a
// restart, can be inspected, and can be served without recomputing.
const BASELINE_CATEGORIES=['light','heavy','motorcycles']
export function rebuildMarketBaseline(categories=BASELINE_CATEGORIES){
 const results=[]
 for(const category of categories){
  try{
   const payloads=store.recentPayloads(category,MARKET_WINDOW_DAYS)
   const index=buildPriceIndex(payloads,{categoryHint:category,windowDays:MARKET_WINDOW_DAYS,reference:referenceIndex})
   const baseline=exportBaseline(index,{category})
   const saved=store.replaceBaseline(category,baseline.rows,{windowDays:MARKET_WINDOW_DAYS,generatedAt:baseline.generatedAt})
   // One immutable snapshot per day so the platform can draw a price trend.
   try{store.snapshotBaseline(category,baseline.rows)}catch(error){console.warn(`[trend] ${category}: ${error.message}`)}
   marketAnalysisCache.delete(category)
   console.log(`[baseline] ${category}: ${saved.rows} cohorts from ${index.stats.considered} listings (${MARKET_WINDOW_DAYS}d window)`)
   results.push({category,...saved,coverage:index.stats})
  }catch(error){console.warn(`[baseline] ${category} failed: ${error.message}`);results.push({category,error:error.message})}
 }
 return results
}

// When results clearly belong to one vehicle model, attach that model's pricing
// knowledge (per year/color averages) — like Dallal's «شناسنامهٔ قیمت» for cars.
function marketIntelFor(items,entry){
 if(!items.length)return null
 const counts=new Map()
 for(const item of items)if(item.model)counts.set(item.model,(counts.get(item.model)||0)+1)
 const [modelKey,hits]=[...counts.entries()].sort((a,b)=>b[1]-a[1])[0]
 if(!modelKey||hits<Math.max(3,Math.ceil(items.length*.5)))return null
 const row=entry.byModel.get(modelKey)
 if(!row)return null
 const years=new Set(items.map(item=>Number(item.year)||0).filter(Boolean))
 const byYear=years.size===1?row.byYear.find(year=>year.year===[...years][0]):null
 return{model:modelKey,cohortKey:row.cohortKey,total:row.samples,avg:row.avg,median:row.median,min:row.min,max:row.max,yearFocus:byYear?{year:byYear.year,samples:byYear.samples,avg:byYear.avg,median:byYear.median}:null}
}

app.get('/api/market/models',(req,res)=>{
 try{
  const category=['light','motorcycles','heavy','parts-accessories','vehicles-services'].includes(String(req.query.category))?String(req.query.category):'light'
  const limit=Math.min(50,Math.max(1,Number(req.query.limit)||24))
  const entry=marketAnalysis(category)
  res.set('Cache-Control','public, max-age=300')
  res.json({category,generatedAt:new Date(entry.stamp).toISOString(),totalModels:entry.summary.totalModels,totalListings:entry.summary.totalListings,models:entry.summary.models.slice(0,limit)})
 }catch(error){res.status(500).json({error:'MARKET_STATS_FAILED',message:error.message})}
})

app.get('/api/listings', rateLimit({ max: 90 }), async (req, res) => {
  const viewer=store.userFromToken(cookieToken(req)),subscription=viewer?store.subscription(viewer.id):null
  const canViewRisk=canViewRiskInsights(viewer,subscription)
  const publicListing=item=>listingForViewer(item,canViewRisk)
  try {
    const filters=searchFilters(req.query);if(!canViewRisk)filters.suspiciousOnly=false
    const offset = Math.max(0, Number(req.query.offset) || 0)
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 6))
    // Serve instantly from the SQLite market database whenever possible; the background
    // warm-up loop keeps it fresh. Falling back to a live Divar crawl is slow (full
    // category sweeps fetch hundreds of pages) and made search feel broken.
    const cityNameOf=new Map(publicVehicleCatalog(store.settings()).cities.map(city=>[String(city.id),city.name]))
    filters.cityNames=(filters.cityIds||[]).map(id=>cityNameOf.get(String(id))).filter(Boolean)
    const entry=marketAnalysis(filters.category)
    const stored=filterListingItems(applyBudget(entry.items, String(req.query.budget||'')), filters)
    const storedFiltered = canViewRisk&&String(req.query.suspiciousOnly)==='true' ? stored.filter(item=>item.suspicious) : stored
    // Hidden listings (dealer bait, >30% under market, failed fraud screen) are kept
    // out of the default feed for everyone and only returned on explicit opt-in.
    const visible=applyVisibility(storedFiltered,req.query)
    if(visible.items.length){
      res.set('Cache-Control', 'private, max-age=60')
      return res.json({ source:'db', category:filters.category, items:visible.items.slice(offset,offset+limit).map(publicListing), totalMatches:visible.items.length, hiddenCount:visible.hiddenCount, dealerCount:visible.dealerCount, showingHidden:visible.showingHidden, visibilityBand:visibilityBand(), offset, limit, riskInsightsUnlocked:canViewRisk, marketIntel:marketIntelFor(visible.items,entry), integration:divar.status() })
    }
    // foreground:true → bounded crawl so the visitor waits seconds, not minutes.
    const result = await divar.listings(filters, { foreground: true })
    if (!result.cached) await persistCrawl(result, { verifyMissing: !result.partial })
    const { observedTokens: _observedTokens, fullSnapshot: _fullSnapshot, ...publicResult } = result
    const budgetFiltered = applyBudget(result.items, String(req.query.budget || ''))
    const filtered = canViewRisk&&String(req.query.suspiciousOnly)==='true' ? budgetFiltered.filter(item=>item.suspicious) : budgetFiltered
    const live=applyVisibility(filtered,req.query)
    res.set('Cache-Control', 'private, max-age=60')
    res.json({ ...publicResult, items: live.items.slice(offset, offset + limit).map(publicListing), totalMatches: live.items.length, hiddenCount:live.hiddenCount, dealerCount:live.dealerCount, showingHidden:live.showingHidden, visibilityBand:visibilityBand(), offset, limit, riskInsightsUnlocked:canViewRisk, integration: divar.status() })
  } catch (error) {
    const known = error instanceof DivarUpstreamError
    console.warn(`[divar:${error.provider || 'none'}] ${error.code || 'ERROR'}: ${error.message}`)
    res.status(200).json({
      source: process.env.NODE_ENV==='production'?'unavailable':'demo',
      items: process.env.NODE_ENV==='production'?[]:applyBudget(fallbackCars, String(req.query.budget || '')).slice(0, Math.min(200, Math.max(1, Number(req.query.limit) || 6))).map(publicListing),
      totalMatches: process.env.NODE_ENV==='production'?0:applyBudget(fallbackCars, String(req.query.budget || '')).length,
      riskInsightsUnlocked:canViewRisk,
      notice: known && error.code === 'NOT_CONFIGURED'
        ? 'اتصال داده واقعی دیوار روی سرور تنظیم نشده است.'
        : process.env.NODE_ENV==='production'?'اتصال سرور به دیوار برقرار نیست؛ برای جلوگیری از نمایش اطلاعات غیرواقعی، داده نمونه مخفی شده است.':'ارتباط با دیوار موقتاً برقرار نشد؛ داده نمونه صرفاً برای پیش‌نمایش توسعه نمایش داده می‌شود.',
      integration: { ...divar.status(), errorCode: error.code || 'UNKNOWN' },
    })
  }
})

// Warm the default market cache now and refresh it every ten minutes. A stale cache is
// served immediately while the next crawl runs in the background.
const warmMarketCache = () => refreshConfiguredMarket().then(result=>console.log(`[divar] refreshed ${result.total} listings across ${result.cities||0} cities and ${result.scopes||0} categories`)).catch(error => console.warn(`[divar:warmup] ${error.code || 'ERROR'}: ${error.message}`))
loadReferenceFromStore()

// Reference sources publish a few times a day, so polling every couple of minutes
// would only burn their bandwidth and risk a block. 15 minutes keeps us current
// within one update cycle while staying a polite citizen.
const referenceIntervalMs=Math.max(5,Number(process.env.REFERENCE_REFRESH_MINUTES)||15)*60*1000
const warmReference=()=>refreshReferencePrices()
 .then(result=>console.log(`[reference] refreshed ${result.rows} prices across ${result.models} models`))
 .catch(error=>console.warn(`[reference:warmup] ${error.message}`))

// Everything below is startup WORK, not startup REQUIREMENTS. Running it before
// app.listen() meant the process spent its first minutes rebuilding baselines and
// sweeping Divar while the port was not even open yet — the visitor who arrived in
// that window simply waited. The server now listens first and warms afterwards.
function startBackgroundWork(){
 try{rebuildMarketBaseline()}catch(error){console.warn(`[baseline:boot] ${error.message}`)}
 if(process.env.REFERENCE_ENABLED!=='false'){warmReference();setInterval(warmReference,referenceIntervalMs).unref()}
 warmMarketCache()
 setInterval(warmMarketCache, cacheTtl).unref()
}

// Serve the compiled SPA directly. Avoiding Vite middleware keeps the preview on
// one unambiguous port; all client-side routes fall back to index.html.
if(process.env.PREVIEW_ROUTE&&process.env.NODE_ENV!=='production')app.get('/',(_req,res)=>res.redirect(process.env.PREVIEW_ROUTE))
app.get('/admin',(_req,res)=>res.redirect(302,'/khodroto-admin'))
const dist = path.resolve('dist')
app.use(express.static(dist, { maxAge: '1h', index: false, redirect: false }))
app.use((req, res, next) => req.method === 'GET' && req.accepts('html') ? res.sendFile(path.join(dist, 'index.html')) : next())
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Khodroto running on http://0.0.0.0:${PORT} · Divar provider: ${divar.status().provider}`)
  // One tick after the port is open, so the first request is never queued behind
  // the baseline rebuild. STARTUP_WARM=false disables it for tests and CI.
  if(process.env.STARTUP_WARM!=='false')setTimeout(startBackgroundWork,100).unref?.()
})
