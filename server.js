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
import { baselineIndex } from './src/server/pricing.js'
import { provinces, citiesOf, groupedCities, nearestCity, resolveCity } from './src/server/locations.js'
import { collectReferencePrices, buildReferenceIndex, referenceStatuses, sourceCatalogue } from './src/server/reference/index.js'
import { providerCatalogue } from './src/server/providers/index.js'
import { visibilityBand } from './src/server/opportunity.js'
import { dedupeListings } from './src/server/dedupe.js'
import { estimateValue } from './src/server/estimate.js'
import { dispatchAlerts } from './src/server/alerts.js'
import { buildModelPages, renderModelPage, renderIndexPage, renderSitemap, renderRobots, slugify } from './src/server/seo.js'
import fs from 'node:fs'
import { collectExternalListings, providerStatuses, setProviderOverrides } from './src/server/providers/index.js'

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
const isProduction = process.env.NODE_ENV === 'production'
function envFlag(name, fallback = false) {
  const value = process.env[name]
  if (value === undefined || value === '') return fallback
  if (/^(1|true|yes|on)$/i.test(value)) return true
  if (/^(0|false|no|off)$/i.test(value)) return false
  return fallback
}
function envNumber(name, fallback, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const value = Number(process.env[name])
  const number = Number.isFinite(value) ? value : fallback
  return Math.min(max, Math.max(min, number))
}
const cacheTtl = Math.max(5, Number(process.env.DIVAR_CACHE_TTL_MINUTES) || 10) * 60 * 1000
const startupWarmEnabled = envFlag('STARTUP_WARM', true)
// Keep the first user request fast on shared cPanel hosts: open the port first,
// then defer the expensive Divar/reference warmup until the app is already serving.
const startupWarmDelayMs = envNumber('STARTUP_WARM_DELAY_MS', isProduction ? 60_000 : 100, { min: 0, max: 3_600_000 })
const marketRefreshIntervalMs = envNumber('MARKET_REFRESH_INTERVAL_MINUTES', Math.ceil(cacheTtl / 60_000), { min: 5, max: 1440 }) * 60 * 1000
// Storage ceiling for the raw listing working set. The crawl runs every few
// minutes, so without a bound the table grows for as long as the server lives
// (~3 KB per listing) and eventually fills the hosting quota, which silently
// breaks deploys. The averages that must outlive the raw rows are already kept
// separately in market_baseline. Set MARKET_MAX_LISTINGS=0 to disable the cap.
const marketMaxListings = envNumber('MARKET_MAX_LISTINGS', 25_000, { min: 0, max: 5_000_000 })
const marketRetentionDays = envNumber('MARKET_RETENTION_DAYS', 0, { min: 0, max: 3650 })
// MARKET_STORAGE_MODE=lean keeps ONLY the distilled averages on disk. The crawl
// still happens, but the ads it walks are summarised in memory and thrown away,
// so the database stops being a function of uptime. Search then answers from the
// live sources and scores against the stored baseline. 'full' is the classic
// behaviour: every ad is persisted and search is served from the database.
const leanStorage = String(process.env.MARKET_STORAGE_MODE || 'full').toLowerCase() === 'lean'
// How many ads one sweep may hold in memory while the averages are computed.
// Only a slim projection is kept (~150 bytes each), never the full payload.
const leanSampleCap = envNumber('MARKET_LEAN_SAMPLE', 40_000, { min: 1_000, max: 500_000 })
// How often the stored averages are rebuilt from a fresh sweep.
const baselineRefreshMs = envNumber('BASELINE_REFRESH_DAYS', 7, { min: 0, max: 365 }) * 86_400_000
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

// A slim projection is everything the price index actually reads: identity comes
// from the title, the cohort from year/colour, and the window from the timestamp.
// Keeping this instead of the payload is the whole point of lean mode.
const leanProjection = item => ({
  id: item.id, token: item.token || item.id, title: item.title, price: item.price,
  year: item.year, color: item.color, km: item.km, city: item.city, link: item.link,
  image: item.image ? '1' : '', lastSeenAt: item.lastSeenAt || new Date().toISOString(),
})

async function persistCrawl(result, { verifyMissing = true } = {}) {
  const category = result.category || 'light'
  const reconciliation = Boolean(result.fullSnapshot && !result.cached)
  if (leanStorage) {
    // Remember only that these tokens existed today; the ads themselves are not
    // written to disk at all.
    store.recordObservations(result.observedTokens || (result.items || []).map(item => item.id), category)
    return
  }
  store.storeCrawl(result, { category, scope: result.scope, reconcile: reconciliation })
  if (!reconciliation || !verifyMissing) return
  const candidates = store.verificationCandidates(category, 25)
  for (const candidate of candidates) {
    const state = await divar.verifyListing(candidate.token)
    if (state !== 'unknown') store.markListingVerification(candidate.token, state)
  }
}

function splitAdminList(value=''){
 return String(value||'').split(/[\n,،]+/).map(item=>item.trim()).filter(Boolean)
}
function crawlerCities(value, fallback){
 const text=String(value||'all').trim()
 if(!text||text.toLowerCase()==='all'||text==='همه')return fallback
 const ids=splitAdminList(text).map(item=>(item.match(/\d+/)||[''])[0]).filter(Boolean)
 return ids.length?[...new Set(ids)]:fallback
}
function crawlerQueries(value=''){
 const list=splitAdminList(value).filter(item=>!['all','همه','*'].includes(item.toLowerCase())).slice(0,5)
 return [...new Set(list)]
}
function crawlerMaxPages(value){
 const pages=Number(value)
 return Number.isFinite(pages)&&pages>0?Math.min(100,Math.max(1,Math.floor(pages))):undefined
}
let marketRefreshRunning=false
async function refreshConfiguredMarket(){
 if(marketRefreshRunning)return{running:true,total:0,pages:0,scopes:0}
 marketRefreshRunning=true
 try{
  const settings=store.settings()
  const cityIds=crawlerCities(settings.crawler_cities,publicVehicleCatalog(settings).cities.map(city=>city.id))
  const queries=crawlerQueries(settings.crawler_queries)
  const maxPages=crawlerMaxPages(settings.crawler_max_pages)
  const categories=['light','heavy','motorcycles','parts-accessories','vehicles-services'],batchSize=Math.max(1,Number(process.env.DIVAR_CITY_BATCH_SIZE)||40)
  const cityBatches=Array.from({length:Math.ceil(cityIds.length/batchSize)},(_,index)=>cityIds.slice(index*batchSize,(index+1)*batchSize))
  let total=0,pages=0,scopes=0
  // Lean mode distils the sweep in memory. Only slim projections are kept, and
  // the sample is capped so a nationwide sweep cannot exhaust a shared host's RAM.
  const leanSamples=leanStorage?new Map():null
  const collectLean=(category,items=[])=>{
   if(!leanSamples)return
   const bucket=leanSamples.get(category)||[]
   for(const item of items){if(bucket.length>=leanSampleCap)break;if(Number(item?.price)>0)bucket.push(leanProjection(item))}
   leanSamples.set(category,bucket)
  }
  // Divar rejects multi-city batches that contain district ids ("multi-city does not
  // support districts"). Retry such batches city by city so one district never
  // poisons the whole batch.
  for(const category of categories)for(const batch of cityBatches){
    for(const queryText of (queries.length?queries:[null])){
      const queue=[[...batch]]
      while(queue.length){
        const ids=queue.shift()
        try{const result=await divar.refresh({category,cityIds:ids,...(queryText?{queryText}:{}),...(maxPages?{maxPages}:{})});collectLean(category,result.items);await persistCrawl(result,{verifyMissing:!queryText});total+=result.totalAnalyzed||result.items?.length||0;pages+=result.pagesFetched||1;scopes++}
        catch(error){
          if(ids.length>1&&(Number(error.status)===400||String(error.message||'').includes('districts'))){for(const id of ids)queue.push([id]);continue}
          console.warn(`[divar] skipping ${category}${queryText?` query:${queryText}`:''} cities:${ids.join(',')} → ${error.code||'ERROR'}: ${error.message}`)
        }
      }
    }
  }
  // Additional market sources (باما/شیپور/رینگ) — enabled via env flags. Failures are
  // logged, never fatal, so the Divar refresh is always the reliable backbone.
  for(const category of categories){
    const externalResults=await collectExternalListings({category,pages:3})
    for(const result of externalResults){
      if(!result.items?.length){if(result.note)console.warn(`[${result.provider||'external'}] ${category} → ${result.note}`);continue}
      collectLean(category,result.items)
      if(!leanStorage)store.storeCrawl({category,scope:result.scope||`${result.provider}:${category}`,items:result.items},{category})
      total+=result.items.length;scopes++
    }
  }
  // The crawl is only half the job: once fresh listings are stored we immediately
  // recompute the 30-day averages, so the site never scores against stale baselines.
  const baseline=rebuildMarketBaseline(BASELINE_CATEGORIES,{samples:leanSamples})
  // Lean mode: the sample has served its purpose the moment the averages exist.
  // Score it once against the fresh baseline to feed alerts and the public
  // counters, then let it go — nothing of it reaches the disk.
  if(leanStorage){
   try{refreshLeanSnapshot(leanSamples)}catch(error){console.warn(`[lean] ${error.message}`)}
   leanSamples?.clear()
  }
  // Order matters: the baseline is distilled FIRST, then the raw rows it was
  // distilled from are trimmed back to the configured ceiling. The knowledge is
  // kept, the bulk is not.
  const trimmed=store.trimListings({maxRows:leanStorage?0:marketMaxListings,retentionDays:leanStorage?1:(marketRetentionDays||MARKET_WINDOW_DAYS)})
  if(trimmed.removedByAge||trimmed.removedByCap)
   console.log(`[storage] trimmed ${trimmed.removedByAge} aged + ${trimmed.removedByCap} over-cap listings (+${trimmed.orphans} orphan rows), ${trimmed.remaining} kept`)
  // Fire-and-forget: a failing SMS provider must never break the crawl.
  runAlerts().catch(error=>console.warn(`[alerts] ${error.message}`))
  return{running:false,total,pages,scopes,cities:cityIds.length,categories:categories.length,baseline,trimmed}
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
/**
 * How many listings one request may return.
 *
 * Paid viewers get the full page size; everyone else gets `free_results` (default
 * 6, tunable in the admin panel). Clamped to a sane floor so a mistyped setting
 * cannot make the site look empty, and to a ceiling so nobody can pull the whole
 * database in one call.
 */
function planResultCap(unlocked) {
  if (unlocked) return 200
  const configured = Number(store.settings().free_results)
  return Math.min(60, Math.max(3, Number.isFinite(configured) && configured > 0 ? configured : 6))
}

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
// A saved alert is the product's sharpest edge: a real opportunity is gone within
// hours, so being told first is what the subscription actually sells. The matcher
// in alerts.js was complete; what was missing was the user ever creating one.
const ALERT_LIMIT=Number(process.env.MAX_ALERTS_PER_USER)||20
const ALERT_FILTER_KEYS=['category','query','queryText','city','cityNames','minPrice','maxPrice','minYear','maxYear','maxUsage','brand','model','color','gearbox','body']
const cleanAlertFilters=input=>{
 const source=input&&typeof input==='object'?input:{}
 const out={}
 for(const key of ALERT_FILTER_KEYS){
  const value=source[key]
  if(value===undefined||value===null||value==='')continue
  if(Array.isArray(value)){const list=value.map(entry=>String(entry).slice(0,60)).filter(Boolean).slice(0,30);if(list.length)out[key]=list;continue}
  if(typeof value==='number'){if(Number.isFinite(value))out[key]=value;continue}
  const text=String(value).slice(0,80)
  if(text&&!text.startsWith('همه'))out[key]=text
 }
 return out
}
app.post('/api/alerts',requireUser,(req,res)=>{
 if(store.countAlerts(req.user.id)>=ALERT_LIMIT)return res.status(409).json({error:'ALERT_LIMIT_REACHED',limit:ALERT_LIMIT})
 const title=String(req.body?.title||'').trim().slice(0,100)||'هشدار خودرو'
 store.createAlert(req.user.id,{title,filters:cleanAlertFilters(req.body?.filters)})
 res.status(201).json({ok:true,items:store.alerts(req.user.id)})
})
app.patch('/api/alerts/:id',requireUser,(req,res)=>{store.toggleAlert(req.user.id,Number(req.params.id),Boolean(req.body.enabled));res.json({ok:true})})
app.delete('/api/alerts/:id',requireUser,(req,res)=>{
 const removed=store.deleteAlert(req.user.id,Number(req.params.id))
 if(!removed)return res.status(404).json({error:'ALERT_NOT_FOUND'})
 res.json({ok:true})
})
app.post('/api/support',requireUser,(req,res)=>{store.createTicket(req.user.id,{subject:String(req.body.subject||'پشتیبانی').slice(0,100),message:String(req.body.message||'').slice(0,2000)});res.status(201).json({ok:true})})
app.post('/api/contact',(req,res)=>{const key=req.ip||'unknown',stamp=Date.now(),recent=(contactAttempts.get(key)||[]).filter(time=>stamp-time<600000);if(recent.length>=5)return res.status(429).json({error:'RATE_LIMITED'});const name=String(req.body?.name||'').trim().slice(0,80),contact=String(req.body?.contact||'').trim().slice(0,120),subject=String(req.body?.subject||'').trim().slice(0,100),message=String(req.body?.message||'').trim().slice(0,2000);if(name.length<2||contact.length<5||subject.length<2||message.length<10)return res.status(400).json({error:'INVALID_INPUT'});contactAttempts.set(key,[...recent,stamp]);store.createTicket(null,{subject:`${subject} — ${name}`,message:`راه ارتباطی: ${contact}\n\n${message}`});res.status(201).json({ok:true})})

app.get('/api/subscription',requireUser,(req,res)=>res.json({subscription:store.subscription(req.user.id)||null}))
app.post('/api/subscription/checkout',requireUser,(req,res)=>{
 const plan=String(req.body.plan||''),managed=store.plans(true).find(item=>item.id===plan&&item.price>0)
 if(!managed)return res.status(400).json({error:'INVALID_PLAN'})
 const gateways=store.integrations('payment').filter(item=>item.enabled&&item.hasSecret).map(({id,name,provider,priority})=>({id,name,provider,priority}))
 const requested=Number(req.body.gatewayId),gateway=gateways.find(item=>item.id===requested)||gateways[0]||null
 const coupon=store.applyDiscount(req.body.coupon||req.body.discountCode||'',managed.price,{consume:true})
 if(!coupon.ok)return res.status(400).json({error:coupon.error,discount:coupon})
 const subscription=store.subscribe(req.user.id,plan,coupon.total)
 const method=String(req.body.method||'online')
 const mode=gateway||process.env.PAYMENT_GATEWAY?'gateway':'sandbox'
 const order=store.recordPaymentOrder({userId:req.user.id,subscriptionId:subscription?.id,plan,method:mode==='gateway'?method:'sandbox',gatewayId:gateway?.id,gatewayName:gateway?.name,couponCode:coupon.code,subtotal:coupon.subtotal,discount:coupon.discount,amount:coupon.total,status:mode==='gateway'?'pending':'paid',note:mode==='gateway'?'در انتظار اتصال/تأیید درگاه':'پرداخت آزمایشی/مدیریتی'})
 res.json({subscription,mode,gateway,gateways,order,pricing:coupon})
})
app.get('/api/listings/:token/history',(req,res)=>res.json({items:store.listHistory(String(req.params.token))}))
// The stored `score` column is only written during a crawl and is never updated
// when the baseline is recomputed, so counting golden opportunities from it
// reported stale numbers — zero on a database filled before tiering existed.
// Count from the live analysis instead, and fall back to the column if that fails.
app.get('/api/stats/public',(_req,res)=>{
 const stats=store.publicStats()
 try{
  const entry=marketAnalysis('light')
  stats.goldenOpportunities=entry.items.filter(item=>!item.hidden&&item.tier==='golden').length
  stats.visibleListings=entry.items.filter(item=>!item.hidden).length
  stats.hiddenListings=entry.items.filter(item=>item.hidden).length
 }catch(error){console.warn(`[stats] ${error.message}`)}
 res.set('Cache-Control','public, max-age=60');res.json(stats)
})
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
   // Lean mode has no stored ads to scan, so alerts run against the scored
   // sample the last sweep left in memory.
   itemsFor: category => { try { return leanStorage ? (leanAlertBuffer.get(category) || []) : marketAnalysis(category).items } catch { return [] } },
   sendSms: sendAlertSms,
  })
  if (result.matched) console.log(`[alerts] ${result.matched} matches · ${result.sent} sent · ${result.queued} queued`)
  return result
 } catch (error) { console.warn(`[alerts] ${error.message}`); return { error: error.message } }
}

app.get('/api/alerts/history', requireUser, (req, res) => res.json({ items: store.alertHistory(req.user.id) }))

// --- In-app notifications ----------------------------------------------------
// An alert that only ever becomes an SMS is invisible to someone already on the
// site, and impossible to verify when the SMS provider is down.
app.get('/api/notifications', requireUser, (req, res) => res.json({
 items: store.notifications(req.user.id, Math.min(100, Math.max(1, Number(req.query.limit) || 30))),
 unread: store.unreadNotifications(req.user.id),
}))
app.post('/api/notifications/read', requireUser, (req, res) => {
 const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(Number).filter(Number.isFinite).slice(0, 100) : null
 const changed = store.markNotificationsRead(req.user.id, ids)
 res.json({ ok: true, changed, unread: store.unreadNotifications(req.user.id) })
})

// --- Saved listings ----------------------------------------------------------
// They lived in localStorage: lost on a new browser, and invisible to the server.
app.get('/api/saved', requireUser, (req, res) => res.json({ items: store.savedListings(req.user.id), tokens: store.savedTokens(req.user.id) }))
app.post('/api/saved', requireUser, (req, res) => {
 const token = String(req.body?.token || req.body?.id || '').slice(0, 120)
 if (!token) return res.status(400).json({ error: 'TOKEN_REQUIRED' })
 // Store a trimmed copy so the dashboard can render the card even after the ad
 // disappears from the live market.
 const source = req.body?.listing || {}
 const keep = ['title','price','city','year','km','color','image','link','score','tier','tierLabel','market','discount','freshness','hidden','dealer']
 store.saveListing(req.user.id, token, Object.fromEntries(keep.map(key => [key, source[key]]).filter(([, value]) => value !== undefined)))
 res.status(201).json({ ok: true, tokens: store.savedTokens(req.user.id) })
})
app.delete('/api/saved/:token', requireUser, (req, res) => {
 store.unsaveListing(req.user.id, String(req.params.token))
 res.json({ ok: true, tokens: store.savedTokens(req.user.id) })
})
// One-shot import of whatever the browser already had, so nobody loses their list.
app.post('/api/saved/import', requireUser, (req, res) => {
 const items = Array.isArray(req.body?.items) ? req.body.items.slice(0, 100) : []
 let imported = 0
 for (const item of items) {
  const token = String(item?.token || item?.id || '')
  if (!token) continue
  store.saveListing(req.user.id, token, item)
  imported += 1
 }
 res.json({ ok: true, imported, tokens: store.savedTokens(req.user.id) })
})
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

const readShell = () => { try { return fs.readFileSync(path.join(dist, 'index.html'), 'utf8') } catch { return null } }

// The hub. Without it every /price/:slug page is an orphan that only the sitemap
// knows about — no internal links in, and no way for a visitor who landed on one
// model to reach another.
app.get('/price', rateLimit({ max: 120 }), (_req, res, next) => {
 const { pages } = seoPages()
 const shell = readShell()
 if (!shell || !pages.length) return next()
 res.set('Cache-Control', 'public, max-age=600')
 res.type('html').send(renderIndexPage(shell, pages, { origin: siteOrigin() }))
})

app.get('/price/:slug', rateLimit({ max: 120 }), (req, res, next) => {
 const { bySlug, pages } = seoPages()
 const page = bySlug.get(slugify(decodeURIComponent(req.params.slug)))
 if (!page) return next()
 const shell = readShell()
 if (!shell) return next()
 res.set('Cache-Control', 'public, max-age=600')
 res.type('html').send(renderModelPage(shell, page, { origin: siteOrigin(), allPages: pages }))
})

// Machine-readable index of every model page, handy for debugging and for the UI.
app.get('/api/seo/models', rateLimit({ max: 30 }), (_req, res) => {
 const { pages } = seoPages()
 res.json({ count: pages.length, items: pages.map(page => ({ slug: page.slug, label: page.label, category: page.category, samples: page.overall.samples, median: page.overall.median, years: page.years.length })) })
})

app.get('/sitemap.xml', (_req, res) => {
 const { pages } = seoPages()
 res.set('Cache-Control', 'public, max-age=3600').type('application/xml')
 res.send(renderSitemap(pages, { origin: siteOrigin(), staticPaths: ['/', '/cars', '/price', '/estimate', '/compare', '/methodology', '/pricing', '/faq', '/about'] }))
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
app.get('/api/subscription/discount',(req,res)=>{
 const plan=store.plans(true).find(item=>item.id===String(req.query.plan||'')&&item.price>0)
 if(!plan)return res.status(400).json({error:'INVALID_PLAN'})
 res.json(store.applyDiscount(String(req.query.code||''),plan.price))
})
app.get('/api/settings/public',(_req,res)=>{const s=store.settings(),keys=['site_name','site_tagline','support_phone','support_email','maintenance_mode','card_golden','card_good','card_fair','card_expensive','card_suspicious','mobile_listing_mode','hero_ticker','hero_title','hero_description','section_slider','section_search','section_opportunities','section_campaign','section_method','section_score','section_faq','feature_comparison','feature_alerts','feature_pricing','score_golden_min','score_good_min','vehicle_categories','vehicle_brands','supported_cities','vehicle_colors','default_city','default_sort','enable_motorcycles','enable_heavy_vehicles','faq_content','faq_enabled','faq_home_count','header_links','footer_platform_links','footer_help_links','footer_description','copyright_text','public_font_scale','show_announcement','enable_motion','campaign_enabled','campaign_title','campaign_description','campaign_discount','campaign_cta','seo_title','seo_description','og_title','og_description','og_image'];res.json(Object.fromEntries(keys.map(key=>[key,s[key]])))})
/**
 * Dealer dashboard.
 *
 * It used to be a private spreadsheet: a dealer typed in what they paid and what
 * they hoped to get, and the platform — whose entire reason to exist is knowing
 * what a car is worth — said nothing about either number. Every inventory row is
 * now valued against the live market, which is the only thing here a showroom
 * cannot already do in Excel.
 */
app.get('/api/dealer/summary',requireDealer,(req,res)=>{
 const inventory=store.dealerInventory(req.user.id)
 const rawLeads=store.dealerLeads(req.user.id)
 let priceIndex=null
 try{priceIndex=marketAnalysis('light').priceIndex}catch{}

 const priced=inventory.map(item=>{
  const valuation=estimateValue({
   title:item.title,brand:item.brand,model:item.model,year:item.year,category:'light',
  },{priceIndex,reference:referenceIndex})
  const addedAt=Date.parse(item.created_at||'')
  const daysInStock=Number.isFinite(addedAt)?Math.max(0,Math.floor((Date.now()-addedAt)/86400000)):null
  const bought=Number(item.buy_price)||0
  const target=Number(item.target_price)||0
  const salePrice=Number(item.sale_price)||0
  const sold=item.status==='sold'
  const actualProfit=sold&&salePrice?salePrice-bought:null
  if(!valuation.ok)return{...item,market:null,marketNote:valuation.message,daysInStock,stale:daysInStock!==null&&daysInStock>=45,actualProfit}
  const market=valuation.estimate
  const askGap=target&&market?Number((((target-market)/market)*100).toFixed(1)):null
  const margin=target&&bought?target-bought:null
  const baseline=Number(item.market_at_add)||0
  const marketDrift=baseline&&market?Number((((market-baseline)/baseline)*100).toFixed(1)):null
  return{
   ...item,
   daysInStock,
   marketDrift,
   stale:daysInStock!==null&&daysInStock>=45,
   market,
   marketRange:valuation.range,
   marketConfidence:valuation.confidence,
   askGap,
   margin,
   actualProfit,
   suggestedPrice:market&&target&&askGap>8?Math.round((market+target)/2):null,
   verdict:!target||!market?'نامشخص'
    :askGap>15?'خیلی بالاتر از بازار؛ احتمال ماندن در نمایشگاه'
    :askGap>8?'بالاتر از بازار؛ فروش کند خواهد بود'
    :askGap<-8?'زیر بازار؛ جا برای افزایش قیمت هست'
    :'هم‌تراز با بازار',
  }
 })

 const inventoryById=new Map(priced.map(item=>[item.id,item]))
 const nowMs=Date.now(),dayMs=86400000
 const leads=rawLeads.map(lead=>{
  const car=lead.inventory_id?inventoryById.get(lead.inventory_id):null
  const nextMs=lead.next_follow_at?Date.parse(lead.next_follow_at):NaN
  const active=!['won','lost'].includes(lead.status)
  return{
   ...lead,
   inventory_title:car?.title||'',
   inventory_target_price:car?.target_price||0,
   inventory_status:car?.status||'',
   linkedPotentialProfit:car?Math.max(0,(Number(car.target_price)||0)-(Number(car.buy_price)||0)):0,
   followupOverdue:active&&Number.isFinite(nextMs)&&nextMs<nowMs,
   followupToday:active&&Number.isFinite(nextMs)&&nextMs>=nowMs&&nextMs<=nowMs+dayMs,
  }
 })

 const leadsByCar=new Map()
 for(const lead of leads){
  if(!lead.inventory_id)continue
  if(!leadsByCar.has(lead.inventory_id))leadsByCar.set(lead.inventory_id,[])
  leadsByCar.get(lead.inventory_id).push({id:lead.id,name:lead.name,phone:lead.phone,status:lead.status,budget:lead.budget,priority:lead.priority,next_follow_at:lead.next_follow_at})
 }
 for(const item of priced){
  item.leads=leadsByCar.get(item.id)||[]
  item.activeLeads=item.leads.filter(lead=>!['won','lost'].includes(lead.status)).length
 }

 const unsold=priced.filter(item=>item.status!=='sold')
 const sold=priced.filter(item=>item.status==='sold')
 const activeLeads=leads.filter(item=>!['won','lost'].includes(item.status))
 const investment=unsold.reduce((sum,item)=>sum+(Number(item.buy_price)||0),0)
 const expected=unsold.reduce((sum,item)=>sum+(Number(item.target_price)||0),0)
 const marketValue=unsold.reduce((sum,item)=>sum+(item.market||Number(item.target_price)||0),0)
 const overpriced=unsold.filter(item=>item.askGap!==null&&item.askGap>8)
 const won=leads.filter(item=>item.status==='won').length

 res.json({
  inventory:priced,
  leads,
  followups:activeLeads.filter(lead=>lead.next_follow_at).sort((a,b)=>Date.parse(a.next_follow_at)-Date.parse(b.next_follow_at)).slice(0,50),
  metrics:{
   inventoryCount:inventory.length,
   available:inventory.filter(item=>item.status==='available').length,
   reserved:inventory.filter(item=>item.status==='reserved').length,
   soldCount:sold.length,
   activeLeads:activeLeads.length,
   hotLeads:activeLeads.filter(item=>item.priority==='hot').length,
   followupsDue:activeLeads.filter(item=>item.followupOverdue||item.followupToday).length,
   overdueFollowups:activeLeads.filter(item=>item.followupOverdue).length,
   leadPipelineValue:activeLeads.reduce((sum,item)=>sum+(Number(item.budget)||Number(item.inventory_target_price)||0),0),
   conversionRate:leads.length?Math.round((won/leads.length)*100):0,
   investment,
   expectedProfit:expected-investment,
   realizedRevenue:sold.reduce((sum,item)=>sum+(Number(item.sale_price)||0),0),
   realizedProfit:sold.reduce((sum,item)=>sum+(Number(item.actualProfit)||0),0),
   marketValue,
   marketVsAsking:expected?Number((((marketValue-expected)/expected)*100).toFixed(1)):null,
   overpricedCount:overpriced.length,
   staleCount:unsold.filter(item=>item.stale).length,
   stalledCapital:unsold.filter(item=>item.stale).reduce((sum,item)=>sum+(Number(item.buy_price)||0),0),
   averageDaysInStock:unsold.length?Math.round(unsold.reduce((sum,item)=>sum+(item.daysInStock||0),0)/unsold.length):0,
   unlinkedLeads:activeLeads.filter(lead=>!lead.inventory_id).length,
  },
  market:store.publicStats(),
 })
})
app.post('/api/dealer/inventory',requireDealer,(req,res)=>{
 try{
  // Freeze what the car is worth today. Recomputing it later from the current
  // baseline would silently rewrite history and make drift always read zero.
  let marketAtAdd=0
  try{
   const valuation=estimateValue({title:req.body?.title,brand:req.body?.brand,model:req.body?.model,year:req.body?.year,category:'light'},
    {priceIndex:marketAnalysis('light').priceIndex,reference:referenceIndex})
   if(valuation.ok)marketAtAdd=valuation.estimate
  }catch{}
  res.status(201).json({items:store.saveDealerInventory(req.user.id,{...req.body,market_at_add:marketAtAdd})})
 }catch{res.status(400).json({error:'INVALID_INVENTORY'})}
})
app.patch('/api/dealer/inventory/:id',requireDealer,(req,res)=>{try{const items=store.saveDealerInventory(req.user.id,req.body||{},Number(req.params.id));if(!items)return res.status(404).json({error:'NOT_FOUND'});res.json({items})}catch{res.status(400).json({error:'INVALID_INVENTORY'})}})
app.delete('/api/dealer/inventory/:id',requireDealer,(req,res)=>{store.deleteDealerInventory(req.user.id,Number(req.params.id));res.json({ok:true})})
app.post('/api/dealer/leads',requireDealer,(req,res)=>{try{res.status(201).json({items:store.saveDealerLead(req.user.id,req.body||{})})}catch{res.status(400).json({error:'INVALID_LEAD'})}})
app.patch('/api/dealer/leads/:id',requireDealer,(req,res)=>{try{const items=store.saveDealerLead(req.user.id,req.body||{},Number(req.params.id));if(!items)return res.status(404).json({error:'NOT_FOUND'});res.json({items})}catch{res.status(400).json({error:'INVALID_LEAD'})}})
app.delete('/api/dealer/leads/:id',requireDealer,(req,res)=>{store.deleteDealerLead(req.user.id,Number(req.params.id));res.json({ok:true})})
app.get('/api/dealer/export.csv',requireDealer,(req,res)=>{
 const esc=value=>`"${String(value??'').replaceAll('"','""')}"`
 const rows=[
  ['نوع','عنوان/نام','خودرو','سال','قیمت خرید/بودجه','قیمت هدف','قیمت فروش','سود واقعی','وضعیت','تلفن','اولویت','منبع','پیگیری بعدی','یادداشت'],
  ...store.dealerInventory(req.user.id).map(item=>['موجودی',item.title,`${item.brand} ${item.model}`,item.year,item.buy_price,item.target_price,item.sale_price||'',item.sale_price?Number(item.sale_price)-Number(item.buy_price||0):'',item.status,'','','','',item.notes||'']),
  ...store.dealerLeads(req.user.id).map(item=>['مشتری',item.name,item.vehicle,'',item.budget,'','', '',item.status,item.phone,item.priority||'',item.source||'',item.next_follow_at||'',item.notes||'']),
 ]
 res.set({'content-type':'text/csv; charset=utf-8','content-disposition':'attachment; filename="khodroto-dealer.csv"'})
 res.send('\ufeff'+rows.map(row=>row.map(esc).join(',')).join('\n'))
})

app.get('/api/admin/stats',adminOnly,(_req,res)=>res.json(store.stats()))
app.get('/api/admin/users',adminOnly,(req,res)=>{
 const result=store.adminUsers({
  query:String(req.query.query||'').slice(0,60),
  role:String(req.query.role||''),
  limit:Math.min(200,Math.max(1,Number(req.query.limit)||50)),
  offset:Math.max(0,Number(req.query.offset)||0),
 })
 res.json(result)
})
app.post('/api/admin/users',adminOnly,(req,res)=>{
 const existing=store.userByPhone(req.body?.phone)
 if(existing)return res.status(409).json({error:'USER_EXISTS',user:existing})
 const user=store.createAdminUser(req.body||{})
 if(!user)return res.status(400).json({error:'INVALID_USER'})
 store.audit(req.user.id,'create','user',String(user.id),{phone:user.phone,role:user.role})
 res.status(201).json({ok:true,user})
})

// --- CSV export -------------------------------------------------------------
// Every admin table was read-only on screen with no way to get the data out, so
// any real analysis meant opening the SQLite file on the server.
const csvCell=value=>{
 const text=value===null||value===undefined?'':String(value)
 return /[",\n;]/.test(text)?`"${text.replace(/"/g,'""')}"`:text
}
const toCsv=(columns,rows)=>[columns.map(col=>csvCell(col.label)).join(','),
 ...rows.map(row=>columns.map(col=>csvCell(col.get(row))).join(','))].join('\n')

const EXPORTS={
 users:{
  file:'users',
  columns:[['شناسه',r=>r.id],['موبایل',r=>r.phone],['نام',r=>r.name],['نقش',r=>r.role],['پلن',r=>r.plan||'رایگان'],['تاریخ عضویت',r=>r.created_at]],
  rows:()=>store.adminUsers({limit:200,offset:0}).items,
 },
 subscriptions:{
  file:'subscriptions',
  columns:[['شناسه',r=>r.id],['کاربر',r=>r.name||r.phone],['پلن',r=>r.plan],['وضعیت',r=>r.status],['مبلغ',r=>r.amount],['شروع',r=>r.started_at],['انقضا',r=>r.expires_at]],
  rows:()=>store.adminSubscriptions(),
 },
 listings:{
  file:'listings',
  columns:[['توکن',r=>r.token],['عنوان',r=>r.title],['شهر',r=>r.city],['قیمت',r=>r.price],['امتیاز',r=>r.score],['دسته',r=>r.category],['وضعیت',r=>r.status],['آخرین مشاهده',r=>r.last_seen_at]],
  rows:()=>store.adminListings(),
 },
}
app.get('/api/admin/export/:kind',adminOnly,(req,res)=>{
 const spec=EXPORTS[String(req.params.kind)]
 if(!spec)return res.status(404).json({error:'UNKNOWN_EXPORT'})
 const columns=spec.columns.map(([label,get])=>({label,get}))
 // The BOM is what makes Excel open a UTF-8 Persian CSV without mojibake.
 const body='\uFEFF'+toCsv(columns,spec.rows())
 store.audit(req.user.id,'export',spec.file,'csv',{rows:body.split('\n').length-1})
 res.set('Content-Type','text/csv; charset=utf-8')
 res.set('Content-Disposition',`attachment; filename="khodroto-${spec.file}-${new Date().toISOString().slice(0,10)}.csv"`)
 res.send(body)
})

// --- Manual reference prices -------------------------------------------------
app.get('/api/admin/reference/manual',adminOnly,(_req,res)=>res.json({items:store.manualReferences()}))
app.post('/api/admin/reference/manual',adminOnly,(req,res)=>{
 const cohortKey=String(req.body?.cohortKey||'').trim()
 const year=Number(req.body?.year)||0
 const price=Math.round(Number(req.body?.price)||0)
 if(!cohortKey||!year||price<=0)return res.status(400).json({error:'INVALID_REFERENCE'})
 store.upsertManualReference({cohortKey,year,price,label:String(req.body?.label||'').slice(0,80),trim:String(req.body?.trim||'').slice(0,40)})
 loadReferenceFromStore()
 marketAnalysisCache.clear()
 store.audit(req.user.id,'upsert','reference_manual',`${cohortKey}|${year}`,{price})
 res.json({ok:true,items:store.manualReferences()})
})
app.delete('/api/admin/reference/manual',adminOnly,(req,res)=>{
 const removed=store.deleteManualReference(String(req.query.cohortKey||''),Number(req.query.year)||0,String(req.query.trim||''))
 if(!removed)return res.status(404).json({error:'NOT_FOUND'})
 loadReferenceFromStore()
 marketAnalysisCache.clear()
 store.audit(req.user.id,'delete','reference_manual',String(req.query.cohortKey||''))
 res.json({ok:true,items:store.manualReferences()})
})
app.patch('/api/admin/users/:id',adminOnly,(req,res)=>{
 const user=store.updateAdminUser(Number(req.params.id),req.body||{})
 if(!user)return res.status(404).json({error:'NOT_FOUND'})
 store.audit(req.user.id,'update','user',req.params.id,{role:user.role,name:user.name,city:user.city})
 res.json({ok:true,user})
})
app.post('/api/admin/users/:id/subscription',adminOnly,(req,res)=>{
 const days=Number(req.body.days)||30
 const row=store.grantSubscription(Number(req.params.id),{plan:String(req.body.plan||'free'),status:String(req.body.status||'active'),days,amount:req.body.amount,expires_at:req.body.expires_at})
 if(!row)return res.status(400).json({error:'INVALID_SUBSCRIPTION'})
 store.audit(req.user.id,'grant','subscription',String(row.id),{userId:req.params.id,plan:row.plan,status:row.status,days})
 res.status(201).json({ok:true,subscription:row})
})
app.get('/api/admin/subscriptions',adminOnly,(_req,res)=>res.json({items:store.adminSubscriptions()}))
app.post('/api/admin/subscriptions',adminOnly,(req,res)=>{
 const row=store.createAdminSubscription(req.body||{})
 if(!row)return res.status(400).json({error:'INVALID_SUBSCRIPTION'})
 store.audit(req.user.id,'create','subscription',String(row.id),{userId:row.user_id,plan:row.plan,status:row.status})
 res.status(201).json({ok:true,subscription:row})
})
app.patch('/api/admin/subscriptions/:id',adminOnly,(req,res)=>{
 const row=store.updateSubscription(Number(req.params.id),req.body||{})
 if(!row)return res.status(400).json({error:'INVALID_SUBSCRIPTION'})
 store.audit(req.user.id,'update','subscription',req.params.id,{plan:row.plan,status:row.status,expires_at:row.expires_at})
 res.json({ok:true,subscription:row})
})
app.get('/api/admin/tickets',adminOnly,(_req,res)=>res.json({items:store.adminTickets()}))
app.patch('/api/admin/tickets/:id',adminOnly,(req,res)=>{const status=['open','pending','closed'].includes(req.body.status)?req.body.status:'open';store.setTicketStatus(Number(req.params.id),status);store.audit(req.user.id,'update_status','ticket',req.params.id,{status});res.json({ok:true})})
app.get('/api/admin/listings',adminOnly,(_req,res)=>res.json({items:store.adminListings()}))
app.patch('/api/admin/listings/:token',adminOnly,(req,res)=>{const status=['active','stale','inactive','removed'].includes(req.body.status)?req.body.status:null;if(!status)return res.status(400).json({error:'INVALID_STATUS'});store.setListingStatus(String(req.params.token),status);store.audit(req.user.id,'update_status','listing',req.params.token,{status});res.json({ok:true})})
app.get('/api/admin/plans',adminOnly,(_req,res)=>res.json({items:store.plans()}))
app.patch('/api/admin/plans/:id',adminOnly,(req,res)=>{const items=store.savePlan(String(req.params.id),req.body||{});if(!items)return res.status(404).json({error:'NOT_FOUND'});store.audit(req.user.id,'update','plan',req.params.id);res.json({items})})
app.get('/api/admin/discounts',adminOnly,(_req,res)=>res.json({items:store.discountCodes()}))
app.post('/api/admin/discounts',adminOnly,(req,res)=>{try{const items=store.saveDiscountCode(req.body||{});store.audit(req.user.id,'create','discount',req.body?.code);res.status(201).json({items})}catch(error){res.status(400).json({error:error.message||'INVALID_DISCOUNT'})}})
app.patch('/api/admin/discounts/:id',adminOnly,(req,res)=>{try{const items=store.saveDiscountCode(req.body||{},Number(req.params.id));if(!items)return res.status(404).json({error:'NOT_FOUND'});store.audit(req.user.id,'update','discount',req.params.id);res.json({items})}catch(error){res.status(400).json({error:error.message||'INVALID_DISCOUNT'})}})
app.delete('/api/admin/discounts/:id',adminOnly,(req,res)=>{const removed=store.deleteDiscountCode(Number(req.params.id));if(!removed)return res.status(404).json({error:'NOT_FOUND'});store.audit(req.user.id,'delete','discount',req.params.id);res.json({ok:true,items:store.discountCodes()})})
app.get('/api/admin/orders',adminOnly,(req,res)=>res.json({items:store.adminOrders(Number(req.query.limit)||200)}))
app.patch('/api/admin/orders/:id',adminOnly,(req,res)=>{const order=store.updateOrder(Number(req.params.id),req.body||{});if(!order)return res.status(404).json({error:'NOT_FOUND'});store.audit(req.user.id,'update','order',req.params.id,{status:order.status});res.json({ok:true,order})})
app.get('/api/admin/settings',adminOnly,(_req,res)=>res.json({settings:store.settings()}))
app.patch('/api/admin/settings',adminOnly,(req,res)=>{
 const settings=store.updateSettings(req.body||{})
 syncProviderOverrides()
 // Scoring policy lives in settings now, so a saved change must invalidate the
 // memoised analysis — otherwise retuning the band appears to do nothing for two
 // minutes and the operator concludes the panel is broken.
 marketAnalysisCache.clear()
 store.audit(req.user.id,'update','settings','general')
 res.json({settings})
})

// One place that answers "is the pipeline healthy, and what can I do about it?"
// Every number here was already computed somewhere; none of it was reachable.
app.get('/api/admin/health',adminOnly,(_req,res)=>{
 const categories=['light','heavy','motorcycles']
 const market=categories.map(category=>{
  try{
   const entry=marketAnalysis(category)
   const tiers={}
   for(const item of entry.items)tiers[item.tier||'unknown']=(tiers[item.tier||'unknown']||0)+1
   return{category,listings:entry.items.length,hidden:entry.items.filter(item=>item.hidden).length,dealers:entry.items.filter(item=>item.dealer).length,models:entry.summary?.totalModels||0,tiers,duplicates:entry.dedupe?.removed||0}
  }catch(error){return{category,error:error.message}}
 })
 let details=null
 try{details=store.detailCache.stats()}catch{}
 res.json({
  integration:divar.status(),
  market,
  enrichment:details,
  sources:{listings:providerStatuses(),reference:referenceStatuses()},
  reference:{models:referenceIndex?.cohorts||0,...store.referenceMeta()},
  policy:visibilityBand(visibilityPolicy()),
  database:store.stats(),
 })
})

// Sellers whose prices repeatedly fail the screen, for the admin table.
// Daily series for the admin charts. Every number was already in the database and
// only ever shown as a single lifetime total.
app.get('/api/admin/analytics',adminOnly,(req,res)=>{
 const days=Math.min(180,Math.max(7,Number(req.query.days)||30))
 res.json(store.analyticsSeries(days))
})

app.get('/api/admin/sellers',adminOnly,(req,res)=>{
 const limit=Math.min(200,Math.max(1,Number(req.query.limit)||50))
 res.json({items:store.worstSellers(limit),minAds:sellerPublicMin()})
})
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
 const analysis=analyzeListings(payloads,{category,includeNoPhoto:true,windowDays:MARKET_WINDOW_DAYS,priceIndex,reference:referenceIndex,policy:visibilityPolicy()})
 const items=analysis.items
 if(priceIndex.stats?.rejected||priceIndex.stats?.review)console.log(`[screen] ${category}: ${priceIndex.stats.rejected} rejected, ${priceIndex.stats.review} needs-review of ${priceIndex.stats.screened} listings`)
 const summary=summarizeMarket(payloads,{category,windowDays:MARKET_WINDOW_DAYS})
 const byModel=new Map(summary.models.map(model=>[model.model,model]))
 const entry={signature,stamp:Date.now(),items,summary,byModel,priceIndex,dedupe:dedupeStats}
 try{recordSellerReputation(items)}catch(error){console.warn(`[sellers] ${error.message}`)}
 // Attach each seller's track record to their listings. A showroom whose ads keep
 // failing the price screen should not look identical to a first-time private
 // seller, and this is the only signal a buyer cannot get from the ad itself.
 try{attachSellerReputation(items)}catch(error){console.warn(`[sellers:attach] ${error.message}`)}
 marketAnalysisCache.set(category,entry)
 return entry
}

// Minimum ads before a seller's record is shown publicly. Below this a single bad
// ad would brand someone a fraudster, which is both unfair and legally risky.
const sellerPublicMin=()=>{const fromSettings=Number(store.settings().seller_reputation_min_ads);if(Number.isFinite(fromSettings)&&fromSettings>0)return fromSettings;return Number(process.env.SELLER_REPUTATION_MIN_ADS)||5}
/**
 * The visibility band as the operator configured it in the admin panel, falling
 * back to the environment and then to the defaults. Tuning the single most
 * important policy in the product should not require SSH access to a .env file.
 */
// Push the panel's source toggles into the provider registry. Called at boot and
// after every settings save so a flipped switch takes effect on the next crawl.
function syncProviderOverrides(){
 const settings=store.settings()
 const overrides={}
 for(const [settingKey,envKey] of Object.entries({
  source_bama:'BAMA_ENABLED',source_sheypoor:'SHEYPOOR_ENABLED',source_ring:'RING_ENABLED',
  source_khodro45:'KHODRO45_ENABLED',source_hamrahmechanic:'HAMRAH_LISTINGS_ENABLED',
 })){
  const value=settings[settingKey]
  if(value==='true'||value==='false')overrides[envKey]=value
 }
 setProviderOverrides(overrides)
 return overrides
}

function visibilityPolicy(){
 const settings=store.settings()
 const pick=(settingKey,envKey)=>{
  const value=Number(settings[settingKey])
  return Number.isFinite(value)&&value>0?String(value):process.env[envKey]
 }
 return {
  OPPORTUNITY_MIN_DISCOUNT:pick('opportunity_min_discount','OPPORTUNITY_MIN_DISCOUNT'),
  OPPORTUNITY_MAX_DISCOUNT:pick('opportunity_max_discount','OPPORTUNITY_MAX_DISCOUNT'),
  HIDE_DEALER_ADS:settings.hide_dealer_ads==='false'?'false':process.env.HIDE_DEALER_ADS==='false'?'false':'true',
 }
}

function attachSellerReputation(items){
 const cache=new Map(),minAds=sellerPublicMin()
 for(const item of items){
  const key=item.sellerKey
  if(!key)continue
  if(!cache.has(key))cache.set(key,store.sellerReputation(key))
  const row=cache.get(key)
  if(!row||row.listings<minAds)continue
  const rejectRate=row.listings?row.rejected/row.listings:0
  item.seller={
   name:item.sellerName||row.label||'فروشنده',
   listings:row.listings,
   flagged:row.rejected+row.review,
   rejectRate:Number(rejectRate.toFixed(2)),
   grade:rejectRate>=0.3?'bad':rejectRate>=0.1?'mixed':'good',
   label:rejectRate>=0.3?'سابقهٔ قیمت‌گذاری نامعتبر':rejectRate>=0.1?'چند آگهی مشکوک در سابقه':'سابقهٔ تمیز',
  }
 }
 return items
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
export function rebuildMarketBaseline(categories=BASELINE_CATEGORIES,{samples=null}={}){
 const results=[]
 for(const category of categories){
  try{
   // Lean mode hands the in-memory sweep sample straight in, because the ads it
   // was distilled from were never written to disk.
   const payloads=samples?.get(category)||store.recentPayloads(category,MARKET_WINDOW_DAYS)
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

// --- Lean storage mode -------------------------------------------------------
// In lean mode the persisted averages ARE the memory of the platform. Everything
// below reads from market_baseline instead of from stored ads.
const leanAlertBuffer=new Map()
const leanBaselineCache=new Map()
const leanModelSummary=new Map()

/** Valuation index rebuilt from the persisted cohorts, cached until they change. */
function leanBaselineIndexFor(category){
 const meta=store.baselineMeta(category)
 const signature=`${meta?.generated_at||''}|${meta?.rows||0}`
 const cached=leanBaselineCache.get(category)
 if(cached&&cached.signature===signature)return cached.index
 const index=baselineIndex(store.baselineRows(category,200000),{generatedAt:meta?.generated_at||null,windowDays:MARKET_WINDOW_DAYS})
 leanBaselineCache.set(category,{signature,index})
 return index
}

/** Score live listings against the stored averages — the lean search path. */
function scoreAgainstBaseline(items,category){
 return analyzeListings(items,{
  category,includeNoPhoto:true,windowDays:MARKET_WINDOW_DAYS,
  priceIndex:leanBaselineIndexFor(category),reference:referenceIndex,policy:visibilityPolicy(),
 })
}

/**
 * Last act of a lean sweep: score the in-memory sample once against the fresh
 * baseline so alerts and the public counters keep working, then drop it. The
 * ads themselves are never written to disk.
 */
function refreshLeanSnapshot(samples){
 if(!samples)return
 let total=0,golden=0
 for(const [category,items] of samples){
  if(!items?.length)continue
  const analysis=scoreAgainstBaseline(items,category)
  total+=items.length
  golden+=analysis.items.filter(item=>Number(item.score)>=85).length
  // Alerts only need the strongest matches, not the whole sweep.
  leanAlertBuffer.set(category,analysis.items.filter(item=>Number(item.score)>0).sort((a,b)=>b.score-a.score).slice(0,2000))
  leanModelSummary.set(category,summarizeMarket(items,{category,windowDays:MARKET_WINDOW_DAYS}))
 }
 store.recordSweepStats({total,golden,active:total})
 console.log(`[lean] summarised ${total} listings into averages, ${golden} golden — nothing persisted`)
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
  // Lean mode has no stored ads to summarise; serve the summary the last sweep
  // produced, which is derived from exactly the same population.
  const summary=leanStorage?leanModelSummary.get(category):null
  const entry=summary?{stamp:Date.now(),summary}:marketAnalysis(category)
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
    // The free-tier cap has to live HERE. It was only ever applied in the UI, which
    // asked for six results — so `?limit=200&offset=0` handed any visitor the whole
    // board and the subscription was decorative. The setting is now authoritative.
    const limit = Math.min(planResultCap(canViewRisk), Math.max(1, Number(req.query.limit) || 6))
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
    // Paging is itself a paid feature: clamping the offset instead of zeroing it
    // would still let a free viewer walk a window across the list and collect more
    // than the cap. They always get the head of the ranking.
    const windowStart=canViewRisk?offset:0
    if(visible.items.length){
      res.set('Cache-Control', 'private, max-age=60')
      return res.json({ source:'db', category:filters.category, items:visible.items.slice(windowStart,windowStart+limit).map(publicListing), totalMatches:visible.items.length, hiddenCount:visible.hiddenCount, dealerCount:visible.dealerCount, showingHidden:visible.showingHidden, visibilityBand:visibilityBand(visibilityPolicy()), offset, limit, riskInsightsUnlocked:canViewRisk, marketIntel:marketIntelFor(visible.items,entry), integration:divar.status() })
    }
    // foreground:true → bounded crawl so the visitor waits seconds, not minutes.
    const result = await divar.listings(filters, { foreground: true })
    if (!result.cached) await persistCrawl(result, { verifyMissing: !result.partial })
    const { observedTokens: _observedTokens, fullSnapshot: _fullSnapshot, ...publicResult } = result
    // Lean mode scores what just came off the wire against the persisted averages,
    // instead of against the handful of ads that happened to be in this response.
    const liveItems = leanStorage ? scoreAgainstBaseline(result.items || [], filters.category).items : result.items
    const budgetFiltered = applyBudget(liveItems, String(req.query.budget || ''))
    const filtered = canViewRisk&&String(req.query.suspiciousOnly)==='true' ? budgetFiltered.filter(item=>item.suspicious) : budgetFiltered
    const live=applyVisibility(filtered,req.query)
    res.set('Cache-Control', 'private, max-age=60')
    res.json({ ...publicResult, items: live.items.slice(canViewRisk?offset:0, (canViewRisk?offset:0) + limit).map(publicListing), totalMatches: live.items.length, hiddenCount:live.hiddenCount, dealerCount:live.dealerCount, showingHidden:live.showingHidden, visibilityBand:visibilityBand(visibilityPolicy()), offset, limit, riskInsightsUnlocked:canViewRisk, integration: divar.status() })
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
syncProviderOverrides()
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
let backgroundWorkStarted=false
/** True while the persisted averages are younger than the refresh interval. */
function baselineIsFresh(){
 if(!baselineRefreshMs)return false
 const stamps=BASELINE_CATEGORIES.map(category=>Date.parse(store.baselineMeta(category)?.generated_at||'')).filter(Number.isFinite)
 if(!stamps.length)return false
 return Date.now()-Math.max(...stamps)<baselineRefreshMs
}

function startBackgroundWork(){
 if(backgroundWorkStarted)return
 backgroundWorkStarted=true
 // Lean mode has no stored ads to rebuild from at boot; its averages come from
 // the sweep below and are already on disk from the previous run.
 if(!leanStorage){try{rebuildMarketBaseline()}catch(error){console.warn(`[baseline:boot] ${error.message}`)}}
 if(process.env.REFERENCE_ENABLED!=='false'){warmReference();setInterval(warmReference,referenceIntervalMs).unref()}
 if(leanStorage){
  // The sweep exists only to refresh the averages, so it runs on the baseline
  // cycle (7 days by default) instead of every few minutes. Search is served
  // live, so nothing is waiting on it. A restart must not re-crawl the country.
  const interval=Math.max(baselineRefreshMs||0,3_600_000)
  if(baselineIsFresh())console.log(`[lean] baseline still fresh; next sweep in ≤${Math.round(interval/86400000)}d`)
  else warmMarketCache()
  setInterval(()=>{if(!baselineIsFresh())warmMarketCache()},Math.min(interval,86_400_000)).unref()
  return
 }
 warmMarketCache()
 setInterval(warmMarketCache, marketRefreshIntervalMs).unref()
}
function scheduleBackgroundWork(){
 if(!startupWarmEnabled){console.log('[startup] background warm disabled (STARTUP_WARM=false)');return}
 const seconds=Math.round(startupWarmDelayMs/1000)
 console.log(`[startup] background warm scheduled in ${seconds}s`)
 setTimeout(startBackgroundWork,startupWarmDelayMs).unref?.()
}

// Serve the compiled SPA directly. Avoiding Vite middleware keeps the preview on
// one unambiguous port; all client-side routes fall back to index.html.
if(process.env.PREVIEW_ROUTE&&process.env.NODE_ENV!=='production')app.get('/',(_req,res)=>res.redirect(process.env.PREVIEW_ROUTE))
app.get('/admin',(_req,res)=>res.redirect(302,'/khodroto-admin'))
const dist = path.resolve('dist')

// An unknown /api/* path used to fall through to the SPA and answer 200 with HTML.
// A caller then got a parse error instead of a 404, a mistyped endpoint looked
// healthy to monitoring, and nothing distinguished "route gone" from "page".
app.use('/api', (req, res) => res.status(404).json({ error: 'NOT_FOUND', path: req.originalUrl }))

// A malformed body or an oversized upload is the client's mistake, not a server
// fault. Express's default handler prints a full stack for each one, which buries
// the failures that actually matter in production logs.
app.use((error, req, res, _next) => {
  const status = Number(error?.status || error?.statusCode) || 500
  const clientFault = status >= 400 && status < 500
  if (clientFault) console.warn(`[http] ${status} ${req.method} ${req.originalUrl} — ${error.type || error.message}`)
  else console.error(`[http] 500 ${req.method} ${req.originalUrl}`, error)
  if (res.headersSent) return
  const body = clientFault
    ? { error: error.type === 'entity.too.large' ? 'PAYLOAD_TOO_LARGE' : 'BAD_REQUEST' }
    : { error: 'INTERNAL_ERROR' }
  res.status(status).json(body)
})

const immutableAssetCache = 'public, max-age=31536000, immutable'
const shortStaticCache = 'public, max-age=86400'
const htmlCache = 'no-cache'
app.use('/assets', express.static(path.join(dist, 'assets'), {
  maxAge: '1y',
  immutable: true,
  index: false,
  redirect: false,
  setHeaders: res => res.setHeader('Cache-Control', immutableAssetCache),
}))
app.use(express.static(dist, {
  maxAge: '1d',
  index: false,
  redirect: false,
  setHeaders: (res, filePath) => res.setHeader('Cache-Control', filePath.endsWith('index.html') ? htmlCache : shortStaticCache),
}))
app.use((req, res, next) => {
  if (!['GET','HEAD'].includes(req.method) || !req.accepts('html')) return next()
  res.set('Cache-Control', htmlCache)
  return res.sendFile(path.join(dist, 'index.html'))
})
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Khodroto running on http://0.0.0.0:${PORT} · Divar provider: ${divar.status().provider}`)
  scheduleBackgroundWork()
})
