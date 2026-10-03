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
 it('prices each vehicle against its own model and year cohort, never a global median',()=>{
  const priced=[pride('p1',480000000),pride('p2',500000000),pride('p3',520000000),pride('p4',495000000),benz('b1',8500000000),benz('b2',9000000000),benz('b3',9200000000),benz('b4',8900000000)]
  const r=analyzeListings(priced)
  const p=r.items.find(x=>x.id==='p2'),b=r.items.find(x=>x.id==='b2')
  expect(p.market).toBeGreaterThan(400000000);expect(p.market).toBeLessThan(650000000)
  expect(b.market).toBeGreaterThan(8000000000);expect(b.market).toBeLessThan(10000000000)
  expect(p.marketLevel).toBe('color');expect(p.model).toBe('پراید');expect(b.model).toBe('مرسدس بنز')
 })
 it('honestly reports when the local cohort for a rare model is too small',()=>{
  const r=analyzeListings([{id:'rare',title:'لامبورگینی اوراکان',price:60000000000,image:'l.jpg',city:'تهران',freshness:'۱ ساعت پیش',year:1402,km:5000,color:'زرد'}])
  expect(r.items[0].market).toBe(0);expect(r.items[0].label).toBe('داده بازار کافی نیست');expect(r.items[0].discount).toBe(0)
 })
 it('trims impostor prices so one typo listing never inflates the cohort average',()=>{
  const r=analyzeListings([pride('a',480000000),pride('b',500000000),pride('c',510000000),pride('d',505000000),pride('e',490000000),pride('fake',1500000000)])
  expect(r.items.find(x=>x.id==='fake').suspicious).toBe(true)
  expect(r.items.find(x=>x.id==='b').market).toBeLessThan(700000000)
 })
 it('identifies models from real listing titles via the catalogue',()=>{
  expect(modelKeyFromTitle('دنا پلاس توربو اتوماتیک بدون رنگ')).toBe('دنا پلاس')
  expect(modelKeyFromTitle('پژو ۲۰۷ دنده‌ای سقف شیشه‌ای')).toBe('پژو ۲۰۷')
  expect(modelKeyFromTitle('شاهین اتوماتیک جی ال')).toBe('شاهین')
 })
 it('summarizes market knowledge per model and build year like the platform pricing base',()=>{
  const summary=summarizeMarket([pride('a',480000000),pride('b',500000000),pride('c',510000000),pride('d',505000000),pride('fake',1900000000),benz('x',8500000000),benz('y',9000000000),benz('z',9200000000),benz('w',8900000000)])
  const p=summary.models.find(model=>model.model==='پراید')
  expect(p.samples).toBeGreaterThanOrEqual(4);expect(p.avg).toBeLessThan(600000000);expect(p.avg).toBeGreaterThan(400000000)
  expect(p.byYear[0].year).toBe(1380);expect(p.byYear[0].avg).toBeLessThan(600000000)
 })
})
