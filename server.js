import express from 'express'
import path from 'node:path'
import crypto from 'node:crypto'
import { fallbackCars } from './src/data.js'
import { createDivarService, DivarUpstreamError } from './src/server/divar.js'
import { createDatabase } from './src/server/database.js'

const app = express()
const PORT = process.env.PORT || 5173
const cacheTtl = Math.max(5, Number(process.env.DIVAR_CACHE_TTL_MINUTES) || 10) * 60 * 1000
const divar = createDivarService({ cacheTtlMs: cacheTtl, cacheFile: process.env.DIVAR_CACHE_FILE || 'data/divar-cache.json' })
const store = createDatabase()
const cookieToken=req=>Object.fromEntries(String(req.headers.cookie||'').split(';').map(x=>x.trim().split('='))).khodroto_session
const requireUser=(req,res,next)=>{const user=store.userFromToken(cookieToken(req));if(!user)return res.status(401).json({error:'AUTH_REQUIRED'});req.user=user;next()}
const adminPreview=process.env.ADMIN_PREVIEW==='true'&&process.env.NODE_ENV!=='production'
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
    category: ['light','motorcycles','heavy'].includes(String(query.category)) ? String(query.category) : 'light',
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
app.post('/api/subscription/checkout',requireUser,(req,res)=>{const plans={pro:199000,dealer:499000},plan=String(req.body.plan||'');if(!plans[plan])return res.status(400).json({error:'INVALID_PLAN'});const gateways=store.integrations('payment').filter(item=>item.enabled&&item.hasSecret).map(({id,name,provider,priority})=>({id,name,provider,priority})),requested=Number(req.body.gatewayId),gateway=gateways.find(item=>item.id===requested)||gateways[0]||null;res.json({subscription:store.subscribe(req.user.id,plan,plans[plan]),mode:gateway||process.env.PAYMENT_GATEWAY?'gateway':'sandbox',gateway,gateways})})
app.get('/api/listings/:token/history',(req,res)=>res.json({items:store.listHistory(String(req.params.token))}))
app.get('/api/stats/public',(_req,res)=>{res.set('Cache-Control','public, max-age=60');res.json(store.publicStats())})
app.get('/api/content/slides',(_req,res)=>{res.set('Cache-Control','public, max-age=60');res.json({items:store.slides(true)})})
app.get('/api/payment/options',(_req,res)=>res.json({items:store.integrations('payment').filter(item=>item.enabled&&item.hasSecret).map(({id,name,provider,priority})=>({id,name,provider,priority}))}))
app.get('/api/settings/public',(_req,res)=>{const s=store.settings();res.json({site_name:s.site_name,site_tagline:s.site_tagline,support_phone:s.support_phone,support_email:s.support_email,maintenance_mode:s.maintenance_mode,card_golden:s.card_golden,card_good:s.card_good,card_fair:s.card_fair,card_expensive:s.card_expensive,card_suspicious:s.card_suspicious,mobile_listing_mode:s.mobile_listing_mode,hero_ticker:s.hero_ticker})})
app.get('/api/admin/stats',adminOnly,(_req,res)=>res.json(store.stats()))
app.get('/api/admin/users',adminOnly,(_req,res)=>res.json({items:store.adminUsers()}))
app.patch('/api/admin/users/:id',adminOnly,(req,res)=>{const role=['user','admin'].includes(req.body.role)?req.body.role:'user';store.setUserRole(Number(req.params.id),role);store.audit(req.user.id,'update_role','user',req.params.id,{role});res.json({ok:true})})
app.get('/api/admin/subscriptions',adminOnly,(_req,res)=>res.json({items:store.adminSubscriptions()}))
app.patch('/api/admin/subscriptions/:id',adminOnly,(req,res)=>{const status=['active','expired','cancelled','pending'].includes(req.body.status)?req.body.status:'pending';store.setSubscriptionStatus(Number(req.params.id),status);store.audit(req.user.id,'update_status','subscription',req.params.id,{status});res.json({ok:true})})
app.get('/api/admin/tickets',adminOnly,(_req,res)=>res.json({items:store.adminTickets()}))
app.patch('/api/admin/tickets/:id',adminOnly,(req,res)=>{const status=['open','pending','closed'].includes(req.body.status)?req.body.status:'open';store.setTicketStatus(Number(req.params.id),status);store.audit(req.user.id,'update_status','ticket',req.params.id,{status});res.json({ok:true})})
app.get('/api/admin/listings',adminOnly,(_req,res)=>res.json({items:store.adminListings()}))
app.patch('/api/admin/listings/:token',adminOnly,(req,res)=>{const status=['active','stale','inactive','removed'].includes(req.body.status)?req.body.status:null;if(!status)return res.status(400).json({error:'INVALID_STATUS'});store.setListingStatus(String(req.params.token),status);store.audit(req.user.id,'update_status','listing',req.params.token,{status});res.json({ok:true})})
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

app.post('/api/admin/crawler/refresh',adminOnly,async(req,res)=>{try{const result=await divar.refresh({});await persistCrawl(result);store.audit(req.user.id,'refresh','crawler','manual',{total:result.totalAnalyzed,pages:result.pagesFetched});res.json({ok:true,total:result.totalAnalyzed,pages:result.pagesFetched,reconciled:Boolean(result.fullSnapshot),source:result.source})}catch(error){const code=error.code||'CRAWLER_ERROR';res.status(error.status>=400&&error.status<600?error.status:502).json({error:code,message:code==='UPSTREAM_ERROR'?'سرور میزبان به شبکه دیوار دسترسی ندارد؛ اتصال ایران یا رله خصوصی را تنظیم کنید.':error.message,integration:divar.status()})}})

app.get('/api/integration/status', (_req, res) => {
  const status = divar.status()
  res.json({ ...status, source: status.provider === 'kenar' ? 'Kenar-e-Divar' : status.provider === 'web' ? 'Divar public web endpoints' : 'disabled', documentation: status.provider === 'kenar' ? 'https://github.com/divar-ir/kenar-docs' : 'https://github.com/shojaee76-cmyk/divar-mcp' })
})

app.get('/api/listings', async (req, res) => {
  try {
    const result = await divar.listings(searchFilters(req.query))
    if (!result.cached) await persistCrawl(result)
    const { observedTokens: _observedTokens, fullSnapshot: _fullSnapshot, ...publicResult } = result
    const budgetFiltered = applyBudget(result.items, String(req.query.budget || ''))
    const filtered = String(req.query.suspiciousOnly)==='true' ? budgetFiltered.filter(item=>item.suspicious) : budgetFiltered
    const offset = Math.max(0, Number(req.query.offset) || 0)
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 6))
    res.set('Cache-Control', 'private, max-age=60')
    res.json({ ...publicResult, items: filtered.slice(offset, offset + limit), totalMatches: filtered.length, offset, limit, integration: divar.status() })
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
const warmMarketCache = () => divar.refresh({}).then(async result => {await persistCrawl(result);console.log(`[divar] cached ${result.totalAnalyzed || result.items.length} listings from ${result.pagesFetched || 1} pages`)} ).catch(error => console.warn(`[divar:warmup] ${error.code || 'ERROR'}: ${error.message}`))
warmMarketCache()
setInterval(warmMarketCache, cacheTtl).unref()

// Serve the compiled SPA directly. Avoiding Vite middleware keeps the preview on
// one unambiguous port; all client-side routes fall back to index.html.
if(process.env.PREVIEW_ROUTE&&process.env.NODE_ENV!=='production')app.get('/',(_req,res)=>res.redirect(process.env.PREVIEW_ROUTE))
app.get('/admin',(_req,res)=>res.redirect(302,'/khodroto-admin'))
const dist = path.resolve('dist')
app.use(express.static(dist, { maxAge: '1h', index: false, redirect: false }))
app.use((req, res, next) => req.method === 'GET' && req.accepts('html') ? res.sendFile(path.join(dist, 'index.html')) : next())
app.listen(PORT, '0.0.0.0', () => console.log(`Khodroto running on http://0.0.0.0:${PORT} · Divar provider: ${divar.status().provider}`))
