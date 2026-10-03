import {describe,expect,it} from 'vitest'
import {analyzeListings,filterListingItems,modelKeyFromTitle,scoreColor,summarizeMarket} from '../src/server/analyzer.js'
const car=(id,price,extra={})=>({id,title:'پژو 207 اتوماتیک',price,image:`${id}.jpg`,city:'تهران',freshness:'۱ ساعت پیش',year:1402,km:30000,color:'سفید',...extra})
describe('automotive analysis engine',()=>{
 it('excludes listings without photos by default',()=>{const r=analyzeListings([car('a',1000),car('b',900,{image:null})]);expect(r.items).toHaveLength(1);expect(r.excludedNoPhoto).toBe(1)})
 it('marks extreme low and high prices as suspicious',()=>{const items=[800,900,950,1000,1050,1100,1150,1200,200,2200].map((p,i)=>car(String(i),p));const r=analyzeListings(items);expect(r.items.find(x=>x.price===200).suspicious).toBe(true);expect(r.items.find(x=>x.price===2200).suspicious).toBe(true);expect(r.suspiciousCount).toBeGreaterThanOrEqual(2)})
 it('raises opportunity score for reasonably cheaper listings',()=>{const r=analyzeListings([car('a',800),car('b',900),car('c',1000),car('d',1100),car('e',1200)]);expect(r.items.find(x=>x.price===800).score).toBeGreaterThan(r.items.find(x=>x.price===1200).score)})
 it('uses red-to-green score colors',()=>{expect(scoreColor(10)).toContain('hsl(13');expect(scoreColor(90)).toContain('hsl(113')})
})
const row=(id,extra={})=>({id,title:'شاهین G اتوماتیک',city:'تهران، پونک',price:900000000,year:1402,km:45000,color:'سفید',score:80,lastSeenAt:'2026-10-01T10:00:00',...extra})
describe('filterListingItems over stored market data',()=>{
 it('matches Persian/Arabic keyboard variants in queries',()=>{expect(filterListingItems([row('a')],{queryText:'شاهين'})).toHaveLength(1);expect(filterListingItems([row('a')],{queryText:'دنا'})).toHaveLength(0)})
 it('requires every query term on the title',()=>{expect(filterListingItems([row('a')],{queryText:'شاهین اتوماتیک'})).toHaveLength(1);expect(filterListingItems([row('a')],{queryText:'شاهین دنده‌ای'})).toHaveLength(0)})
 it('filters by city names resolved from ids',()=>{expect(filterListingItems([row('a')],{cityNames:['تهران']})).toHaveLength(1);expect(filterListingItems([row('a')],{cityNames:['مشهد']})).toHaveLength(0)})
 it('applies price, year and usage bounds strictly',()=>{expect(filterListingItems([row('a')],{minPrice:'950000000'})).toHaveLength(0);expect(filterListingItems([row('a')],{maxPrice:'950000000'})).toHaveLength(1);expect(filterListingItems([row('a')],{minYear:'1403'})).toHaveLength(0);expect(filterListingItems([row('a')],{maxYear:'1403'})).toHaveLength(1);expect(filterListingItems([row('a')],{maxUsage:'40000'})).toHaveLength(0);expect(filterListingItems([row('a',{km:0})],{maxUsage:'40000'})).toHaveLength(0);expect(filterListingItems([row('a',{km:0})],{})).toHaveLength(1)})
 it('ignores dimensions that stored payloads do not carry',()=>{expect(filterListingItems([row('a')],{gearbox:'دنده‌ای',body:'بدون رنگ',seller:'نمایشگاه'})).toHaveLength(1)})
 it('sorts by score, price and recency',()=>{const items=[row('a',{score:50,price:900000000,lastSeenAt:'2026-10-01T08:00:00'}),row('b',{score:90,price:500000000,lastSeenAt:'2026-10-01T10:00:00'})];expect(filterListingItems(items,{sort:'score'})[0].id).toBe('b');expect(filterListingItems(items,{sort:'cheap'})[0].id).toBe('b');expect(filterListingItems(items,{sort:'expensive'})[0].id).toBe('a');expect(filterListingItems(items,{sort:'newest'})[0].id).toBe('b')})
})
const pride=(id,price,extra={})=>({id,title:'پراید صبا دوگانه‌سوز مدل ۸۰',price,image:`${id}.jpg`,city:'تهران',freshness:'۱ ساعت پیش',year:1380,km:120000,color:'سفید',...extra})
const benz=(id,price)=>({id,title:'مرسدس بنز E350 اتوماتیک',price,image:`${id}.jpg`,city:'تهران',freshness:'۱ ساعت پیش',year:1396,km:80000,color:'مشکی'})
describe('per-model, per-year, per-color market pricing engine',()=>{
 const many=(make,prices)=>prices.map((price,index)=>make(`x${index}`,price))
 it('prices each vehicle against its own model and year cohort, never a global median',()=>{
  const priced=[
   ...many(pride,[470,480,490,495,500,505,510,515,520,525].map(v=>v*1000000)),
   ...many(benz,[8300,8500,8700,8900,9000,9100,9200,9300].map(v=>v*1000000)),
  ]
  const r=analyzeListings(priced)
  const p=r.items.find(x=>x.price===500000000),b=r.items.find(x=>x.price===9000000000)
  expect(p.market).toBeGreaterThan(400000000);expect(p.market).toBeLessThan(650000000)
  expect(b.market).toBeGreaterThan(8000000000);expect(b.market).toBeLessThan(10000000000)
  expect(p.marketLevel).toBe('color');expect(p.model).toBe('پراید صبا');expect(b.model).toBe('بنز E350')
 })
 it('honestly reports when the local cohort for a rare model is too small',()=>{
  const r=analyzeListings([{id:'rare',title:'لامبورگینی اوراکان',price:60000000000,image:'l.jpg',city:'تهران',freshness:'۱ ساعت پیش',year:1402,km:5000,color:'زرد'}])
  expect(r.items[0].market).toBe(0);expect(r.items[0].label).toBe('داده بازار کافی نیست');expect(r.items[0].discount).toBe(0)
  expect(r.items[0].score).toBeNull()
 })
 it('refuses to price a cohort that is thinner than the minimum sample size',()=>{
  // Four ads are not a market. The old engine happily averaged them.
  const r=analyzeListings(many(pride,[480,500,510,505].map(v=>v*1000000)))
  expect(r.items.every(item=>item.market===0)).toBe(true)
  expect(r.items.every(item=>item.label==='داده بازار کافی نیست')).toBe(true)
 })
 it('trims impostor prices so one typo listing never inflates the cohort average',()=>{
  const r=analyzeListings([...many(pride,[470,480,490,495,500,505,510,515,520,525].map(v=>v*1000000)),pride('fake',1500000000)])
  expect(r.items.find(x=>x.id==='fake').suspicious).toBe(true)
  expect(r.items.find(x=>x.price===500000000).market).toBeLessThan(700000000)
 })
 it('identifies models from real listing titles via the catalogue',()=>{
  expect(modelKeyFromTitle('دنا پلاس توربو اتوماتیک بدون رنگ')).toBe('دنا پلاس')
  expect(modelKeyFromTitle('پژو ۲۰۷ دنده‌ای سقف شیشه‌ای')).toBe('پژو ۲۰۷')
  expect(modelKeyFromTitle('شاهین اتوماتیک جی ال')).toBe('شاهین')
 })
 it('summarizes market knowledge per model and build year like the platform pricing base',()=>{
  const summary=summarizeMarket([
   ...many(pride,[470,480,490,495,500,505,510,515,520,525,515,490].map(v=>v*1000000)),
   ...many(benz,[8300,8500,8700,8900,9000,9100,9200,9300,8800,8600,9050,8950].map(v=>v*1000000)),
  ])
  const p=summary.models.find(model=>model.model==='پراید صبا')
  expect(p.samples).toBeGreaterThanOrEqual(10);expect(p.avg).toBeLessThan(600000000);expect(p.avg).toBeGreaterThan(400000000)
  expect(p.byYear[0].year).toBe(1380);expect(p.byYear[0].avg).toBeLessThan(600000000)
 })
})

// --- Regression suite for the live-site defects reported on 1405/07/11 ---------
describe('regression: cohorts reported as wrong on bidup.ir',()=>{
 const M=1e6
 const heavy=(id,title,price,year)=>({id,title,price:price*M,image:`${id}.jpg`,city:'تهران',freshness:'۲ روز پیش',year,km:300000,color:'—'})
 const spread=(title,year,prices)=>prices.map((p,i)=>heavy(`${title}-${i}`,title,p,year))

 it('never pools a 1359 minibus with a 2018 Scania tractor unit',()=>{
  const items=[
   ...spread('مینی بوس بنز ۳۰۲ مدل ۱۳۵۸',1358,[700,720,740,750,760,780,800,730,770,745]),
   ...spread('کامیون کشنده اسکانیا R500 مدل 2018',1397,[5800,5900,6000,6100,6200,5950,6050,6150,5850,6000]),
  ]
  const r=analyzeListings(items,{category:'heavy'})
  const bus=r.items.find(x=>x.title.includes('مینی بوس'))
  const truck=r.items.find(x=>x.title.includes('کشنده'))
  expect(bus.cohortKey).not.toBe(truck.cohortKey)
  expect(bus.market).toBeLessThan(1000*M)
  expect(truck.market).toBeGreaterThan(5000*M)
 })

 it('keeps a Volvo trailer out of the Volvo passenger-car cohort',()=>{
  const trailer=analyzeListings(spread('تریلی ولوو FH مدل 2017',1396,[4000,4200,4400,4100,4300,4250,4150,4350]),{category:'heavy'}).items[0]
  expect(trailer.segment).toBe('heavy')
  expect(trailer.cohortKey).toContain('کشنده')
 })

 it('separates پراید ۱۳۱ from پراید ۱۱۱ instead of averaging them together',()=>{
  const a=modelKeyFromTitle('پراید ۱۳۱ مدل ۱۳۹۰ دوگانه')
  const b=modelKeyFromTitle('پراید ۱۱۱ مدل ۱۳۹۵')
  expect(a).not.toBe(b)
 })

 it('does not label the whole result set as a golden opportunity',()=>{
  const prices=[700,720,740,750,760,780,800,730,770,745,755,765]
  const r=analyzeListings(spread('مینی بوس بنز ۳۰۲ مدل ۱۳۵۸',1358,prices),{category:'heavy'})
  const winners=r.items.filter(item=>['exceptional','strong'].includes(item.grade))
  expect(winners.length).toBeLessThanOrEqual(2)
  expect(r.opportunityCount).toBeLessThanOrEqual(2)
 })

 it('unifies Gregorian and Jalali build years into one cohort',()=>{
  const items=[
   ...spread('کامیون کشنده اسکانیا R500 مدل 2018',0,[5800,5900,6000,6100,6200,5950]),
   ...spread('کامیون کشنده اسکانیا R500 مدل ۱۳۹۷',0,[6050,6150,5850,6000,5975,6025]),
  ]
  const r=analyzeListings(items,{category:'heavy'})
  expect(new Set(r.items.map(item=>item.cohortKey)).size).toBe(1)
  expect(r.items[0].marketSamples).toBeGreaterThanOrEqual(10)
 })

 it('only counts listings seen inside the rolling window',()=>{
  const now=Date.UTC(2026,9,3)
  const old=new Date(now-200*86400000).toISOString()
  const items=spread('مینی بوس بنز ۳۰۲ مدل ۱۳۵۸',1358,[700,720,740,750,760,780,800,730,770,745]).map(item=>({...item,lastSeenAt:old}))
  const r=analyzeListings(items,{category:'heavy',now,windowDays:30})
  expect(r.items.every(item=>item.market===0)).toBe(true)
 })
})
