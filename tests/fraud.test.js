import {describe,expect,it} from 'vitest'
import {screenListing,screenAll,referenceTolerance} from '../src/server/fraud.js'
import {buildReferenceIndex,identifyRow} from '../src/server/reference/index.js'
import {buildPriceIndex,summarizeIndex} from '../src/server/pricing.js'
import {analyzeListings} from '../src/server/analyzer.js'
import {parseModelPage} from '../src/server/reference/hamrah-mechanic.js'

const M=1e6
// Real کوییک valuations published by همراه مکانیک.
const QUICK=[[1405,1290],[1404,1220],[1403,1160],[1402,1030],[1399,865],[1397,720]]
const reference=buildReferenceIndex(QUICK.map(([year,price])=>identifyRow({brand:'سایپا',model:'کوییک',year,price:price*M,source:'hamrah-mechanic'})).filter(Boolean))
const ad=(title,priceM,year,extra={})=>({id:`${title}-${priceM}`,title,price:priceM*M,year,color:'سفید',km:90000,image:'i.jpg',city:'تهران',freshness:'۲ روز پیش',...extra})

describe('reference price index',()=>{
 it('indexes every published build year and exposes the model floor',()=>{
  expect(reference.cohorts).toBe(1)
  expect(reference.size).toBe(6)
  const key=identifyRow({brand:'سایپا',model:'کوییک',year:1402,price:1030*M}).cohortKey
  expect(reference.priceFor(key,1402).price).toBe(1030*M)
  expect(reference.floorFor(key)).toBe(720*M)
 })
 it('falls back to a nearby build year within two years',()=>{
  const key=identifyRow({brand:'سایپا',model:'کوییک',year:1402,price:1030*M}).cohortKey
  const near=reference.priceFor(key,1401)
  expect(near.exact).toBe(false)
  expect(near.year).toBe(1402)
 })
})

describe('bait and instalment price screen',()=>{
 it('rejects the reported «کوییک ۵۸۰ میلیون» bait ad',()=>{
  const verdict=screenListing(ad('کوییک ۱۴۰۲ دنده ای سفید',580,1402),{reference})
  expect(verdict.severity).toBe('reject')
  expect(verdict.flags.map(f=>f.code)).toContain('BELOW_REFERENCE')
  expect(verdict.reference.price).toBe(1030*M)
 })
 it('rejects an ad that advertises only the down payment',()=>{
  const verdict=screenListing(ad('کوییک ۱۴۰۳ اقساطی با پیش پرداخت',350,1403),{reference})
  expect(verdict.severity).toBe('reject')
  expect(verdict.flags.map(f=>f.code)).toEqual(expect.arrayContaining(['INSTALMENT','BELOW_REFERENCE']))
 })
 it('rejects حواله / pre-sale ads whose price is not a car price',()=>{
  expect(screenListing(ad('کوییک ۱۴۰۵ صفر حواله',700,1405),{reference}).severity).toBe('reject')
  expect(screenListing(ad('پراید معاوضه با ۲۰۶',400,1390),{reference}).severity).toBe('reject')
 })
 it('rejects placeholder bait numbers',()=>{
  const verdict=screenListing(ad('کوییک ۱۴۰۲',111.111111,1402),{reference})
  expect(verdict.flags.map(f=>f.code)).toContain('BAIT_NUMBER')
  expect(verdict.severity).toBe('reject')
 })
 it('accepts an honestly priced ad',()=>{
  expect(screenListing(ad('کوییک ۱۴۰۲ فول',1000,1402),{reference}).severity).toBe('ok')
  expect(screenListing(ad('کوییک ۱۳۹۹ سالم بیرنگ',840,1399),{reference}).severity).toBe('ok')
 })
 it('does not punish an honest «نقد و اقساط» ad whose cash price is right',()=>{
  const verdict=screenListing(ad('کوییک ۱۴۰۴ نقد و اقساط',1200,1404),{reference})
  expect(verdict.severity).toBe('review')
  expect(verdict.severity).not.toBe('reject')
 })
 it('widens tolerance for old cars so a battered 1397 is not called fake',()=>{
  expect(referenceTolerance(1404).reject).toBeGreaterThan(referenceTolerance(1385).reject)
  expect(screenListing(ad('کوییک ۱۳۹۷ پرکارکرد رنگ شده',520,1397),{reference}).severity).toBe('review')
 })
 it('flags a price far above the dearest version of the model',()=>{
  const verdict=screenListing(ad('کوییک ۱۴۰۵ صفر',4000,1405),{reference})
  expect(verdict.flags.map(f=>f.code)).toContain('ABOVE_REFERENCE')
 })
})

describe('fake ads must not move the market average',()=>{
 const honest=[980,1000,1010,1020,1030,1040,1050,990,1015,1025,1035,1005].map(p=>ad('کوییک ۱۴۰۲ دنده ای',p,1402))
 const fakes=[580,600,550,620,590,575].map(p=>ad('کوییک ۱۴۰۲ دنده ای',p,1402))

 it('holds the average steady even when fake ads outnumber real ones',()=>{
  // The realistic failure mode: a dealer floods the model with bait prices. Once
  // they are the majority, quartile trimming alone cannot save the average —
  // only an independent reference can.
  const flood=Array.from({length:14},(_,i)=>ad('کوییک ۱۴۰۲ دنده ای',550+i*8,1402))
  const dirty=buildPriceIndex([...honest,...flood],{categoryHint:'light',reference,screen:false})
  const clean=buildPriceIndex([...honest,...flood],{categoryHint:'light',reference})
  expect(summarizeIndex(dirty,{minSamples:5}).models[0].median).toBeLessThan(700*M)
  expect(summarizeIndex(clean,{minSamples:5}).models[0].median).toBeGreaterThan(990*M)
  expect(clean.stats.rejected).toBe(14)
 })

 it('excludes rejected listings from the baseline',()=>{
  const clean=buildPriceIndex([...honest,...fakes],{categoryHint:'light',reference})
  expect(clean.stats.rejected).toBe(6)
  expect(clean.stats.considered).toBe(honest.length)
  expect(summarizeIndex(clean,{minSamples:5}).models[0].median).toBeGreaterThan(990*M)
 })

 it('still shows the fake ad but never as an opportunity',()=>{
  const result=analyzeListings([...honest,...fakes],{category:'light',reference})
  const fake=result.items.find(item=>item.price===580*M)
  expect(fake).toBeDefined()
  expect(fake.trust).toBe('reject')
  expect(fake.label).toBe('قیمت غیرواقعی یا اقساطی')
  expect(fake.eligible).toBe(false)
  expect(fake.score).toBeLessThanOrEqual(12)
  expect(result.rejectedCount).toBe(6)
  expect(result.opportunityCount).toBe(0)
 })
})

describe('hamrah-mechanic parser',()=>{
 it('reads per-year prices out of a model index page',()=>{
  const html=`
   <a href="https://www.hamrah-mechanic.com/carprice/saipa/quick/1405/">سایپا کوییک 1405 S</a>
   <span>1,290,000,000 تومان</span>
   <a href="https://www.hamrah-mechanic.com/carprice/saipa/quick/1404/">سایپا کوییک 1404 S</a>
   <span>1,220,000,000 تومان</span>`
  const rows=parseModelPage(html,{brand:'سایپا',model:'کوییک'})
  expect(rows).toHaveLength(2)
  expect(rows[0]).toMatchObject({year:1405,price:1290000000,condition:'used'})
 })
 it('ignores junk numbers that are not prices',()=>{
  expect(parseModelPage('<a href="/carprice/saipa/quick/1405/">x</a><span>12 تومان</span>',{brand:'سایپا',model:'کوییک'})).toHaveLength(0)
 })
})

import {bazarkhodroPrices} from '../src/server/reference/bazarkhodro.js'

describe('bazarkhodro parser',()=>{
 // Markup shaped like the real SSR output: anchor first, amount inside the card.
 const page=`
  <div class="brand">آئودی</div>
  <a href="/price/audi/a-3-l_1500-liter-turbo/2025"><span>A3 1.5 توربو، 2025</span><b>10,500,000,000</b><i>%0</i></a>
  <a href="/price/saipa/quick_s/1405"><span>کوییک S، 1405</span><b>1,290,000,000</b><i>%0</i></a>
  <a href="/price/saipa/quick_rs/1404"><span>کوییک RS، 1404</span><b>1,380,000,000</b></a>
  <a href="/price/atlas/g_manual/1404"><span>اطلس G دنده ای، 1404</span><b>1,670,000,000</b></a>
  <a href="/price/mvm/x33cross_at/1405/%D9%85%D8%AF%DB%8C%D8%B1%D8%A7%D9%86"><span>X33 کراس</span><b>3,700,000,000</b></a>
  <a href="/car/some-listing">آگهی معمولی بدون قیمت مرجع</a>`
 const originalFetch=globalThis.fetch

 it('extracts brand, model, trim, year and price from the price board',async()=>{
  globalThis.fetch=async()=>({ok:true,status:200,text:async()=>page})
  try{
   const result=await bazarkhodroPrices()
   expect(result.rows.length).toBe(5)
   const quick=result.rows.find(row=>row.model==='کوییک'&&row.year===1405)
   expect(quick).toMatchObject({brand:'سایپا',trim:'s',year:1405,price:1290000000,condition:'new'})
   const audi=result.rows.find(row=>row.brand==='آئودی')
   expect(audi.year).toBe(2025)
   expect(result.rows.every(row=>row.price>=50_000_000)).toBe(true)
  }finally{globalThis.fetch=originalFetch}
 })

 it('reports a shape change instead of returning silent garbage',async()=>{
  globalThis.fetch=async()=>({ok:true,status:200,text:async()=>'<html><body>redesigned</body></html>'})
  try{
   const result=await bazarkhodroPrices()
   expect(result.rows).toHaveLength(0)
   expect(result.note).toContain('SHAPE_CHANGED')
  }finally{globalThis.fetch=originalFetch}
 })

 it('survives an unreachable source',async()=>{
  globalThis.fetch=async()=>{throw new Error('ECONNRESET')}
  try{
   const result=await bazarkhodroPrices()
   expect(result.rows).toHaveLength(0)
   expect(result.note).toContain('FETCH_FAILED')
  }finally{globalThis.fetch=originalFetch}
 })
})
