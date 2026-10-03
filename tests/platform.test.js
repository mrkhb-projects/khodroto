import {describe,expect,it} from 'vitest'
import {dedupeListings,duplicateKey} from '../src/server/dedupe.js'
import {estimateValue,mileageFactor} from '../src/server/estimate.js'
import {alertWorthy,parseQuietHours,inQuietHours,renderMessage,dispatchAlerts} from '../src/server/alerts.js'
import {buildPriceIndex} from '../src/server/pricing.js'
import {buildReferenceIndex,identifyRow} from '../src/server/reference/index.js'
import {enrichListings} from '../src/server/divar.js'

const M=1e6
const car=(over={})=>({id:Math.random().toString(36).slice(2),token:Math.random().toString(36).slice(2),title:'پژو ۲۰۷ اتوماتیک مدل ۱۴۰۱',price:950*M,year:1401,km:60000,color:'سفید',city:'تهران',source:'دیوار',image:'i.jpg',freshness:'۲ روز پیش',...over})

describe('cross-source deduplication',()=>{
 it('collapses the same car posted on several sites',()=>{
  const items=[
   car({id:'a',source:'دیوار'}),
   car({id:'b',source:'باما'}),
   car({id:'c',source:'شیپور'}),
   car({id:'d',price:880*M}),
  ]
  const {items:merged,stats}=dedupeListings(items)
  expect(stats.removed).toBe(2)
  expect(merged).toHaveLength(2)
  const kept=merged.find(item=>item.duplicateCount===3)
  expect(kept.source).toBe('باما')            // highest trust among the three
  expect(kept.alsoOn).toEqual(expect.arrayContaining(['دیوار','شیپور']))
 })

 it('keeps genuinely different cars apart',()=>{
  const a=car({price:950*M,year:1401}),b=car({price:950*M,year:1399})
  expect(duplicateKey(a)).not.toBe(duplicateKey(b))
  expect(dedupeListings([a,b]).stats.removed).toBe(0)
 })

 it('fills missing colour and mileage from the duplicate copies',()=>{
  const merged=dedupeListings([
   car({id:'a',source:'دیوار',color:'—',km:0}),
   car({id:'b',source:'باما',color:'مشکی',km:72000}),
  ]).items[0]
  expect(merged.color).toBe('مشکی')
  expect(merged.km).toBe(72000)
 })

 it('stops one dealer from triple-weighting their own price',()=>{
  const honest=[980,1000,1010,1020,1030,1040,1050,990,1015,1025,1035,1005].map(p=>car({price:p*M}))
  const spam=Array.from({length:9},()=>car({price:1400*M,city:'تهران',year:1401,km:60000}))
  const raw=buildPriceIndex([...honest,...spam],{categoryHint:'light',screen:false})
  const deduped=buildPriceIndex(dedupeListings([...honest,...spam]).items,{categoryHint:'light',screen:false})
  expect(raw.index.get([...raw.index.keys()][0]).prices.length).toBe(21)
  expect(deduped.index.get([...deduped.index.keys()][0]).prices.length).toBe(13)
 })
})

describe('value-my-car estimator',()=>{
 const reference=buildReferenceIndex([[1405,1290],[1403,1160],[1402,1030],[1399,865]]
  .map(([year,price])=>identifyRow({brand:'سایپا',model:'کوییک',year,price:price*M,source:'h'})).filter(Boolean))

 it('values a car from the published reference',()=>{
  const result=estimateValue({brand:'سایپا',model:'کوییک',year:1402,km:80000,body:'بدون رنگ'},{reference})
  expect(result.ok).toBe(true)
  expect(result.estimate).toBeGreaterThan(900*M)
  expect(result.estimate).toBeLessThan(1150*M)
  expect(result.range.low).toBeLessThan(result.estimate)
  expect(result.range.high).toBeGreaterThan(result.estimate)
 })

 it('discounts high mileage and accident damage',()=>{
  const clean=estimateValue({brand:'سایپا',model:'کوییک',year:1402,km:60000,body:'بدون رنگ'},{reference})
  const beaten=estimateValue({brand:'سایپا',model:'کوییک',year:1402,km:260000,body:'تصادفی'},{reference})
  expect(beaten.estimate).toBeLessThan(clean.estimate*0.8)
 })

 it('admits when it does not know instead of guessing',()=>{
  expect(estimateValue({title:'لامبورگینی اوراکان',year:1402},{reference}).ok).toBe(false)
  expect(estimateValue({title:'یک ماشین',year:1402},{reference}).reason).toBe('MODEL_UNKNOWN')
 })

 it('widens the range when inputs are missing',()=>{
  const full=estimateValue({brand:'سایپا',model:'کوییک',year:1402,km:80000},{reference})
  const sparse=estimateValue({brand:'سایپا',model:'کوییک',year:1402},{reference})
  const width=r=>r.range.high-r.range.low
  expect(width(sparse)).toBeGreaterThan(width(full))
  expect(sparse.confidence).toBeLessThan(full.confidence)
 })

 it('treats typical mileage as neutral',()=>{
  expect(mileageFactor(60000,1402)).toBeCloseTo(1,1)
  expect(mileageFactor(200000,1402)).toBeLessThan(1)
  expect(mileageFactor(5000,1402)).toBeGreaterThan(1)
 })
})

describe('alert dispatch',()=>{
 const good={id:'g1',title:'پژو ۲۰۷ اتوماتیک',price:800*M,market:950*M,discount:15.8,score:82,grade:'strong',trust:'ok',eligible:true,suspicious:false,city:'تهران',year:1401,km:50000}
 const fair={id:'f1',title:'پژو ۲۰۷ اتوماتیک',price:950*M,market:950*M,score:52,grade:'fair',trust:'ok',eligible:true,suspicious:false,city:'تهران',year:1401,km:50000}
 const fake={id:'x1',title:'پژو ۲۰۷ اتوماتیک',price:400*M,market:950*M,score:10,grade:'suspicious',trust:'reject',eligible:false,suspicious:true,city:'تهران',year:1401,km:50000}

 it('only alerts on trusted, genuinely good opportunities',()=>{
  const worthy=alertWorthy([good,fair,fake],{minScore:70})
  expect(worthy.map(item=>item.id)).toEqual(['g1'])
 })

 it('parses and honours quiet hours',()=>{
  const quiet=parseQuietHours('۲۲:۰۰ تا ۸:۰۰')
  expect(quiet).toEqual({from:22,to:8})
  expect(inQuietHours(new Date('2026-10-03T00:30:00+03:30'),quiet)).toBe(true)
  expect(inQuietHours(new Date('2026-10-03T14:00:00+03:30'),quiet)).toBe(false)
 })

 it('renders the template with real values',()=>{
  const text=renderMessage('{{title}} · {{price}} میلیون · {{discount}}٪ زیر بازار',good,{title:'هشدار من'})
  expect(text).toContain('پژو ۲۰۷')
  expect(text).toContain('۱۶٪ زیر بازار')
 })

 it('sends each listing at most once per alert',async()=>{
  const sentTo=[]
  const delivered=new Set()
  const store={
   settings:()=>({notification_master:'true',sms_alert_enabled:'true',quiet_hours:'',score_good_min:'70',opportunity_template:'{{title}}'}),
   enabledAlerts:()=>[{id:1,user_id:7,title:'۲۰۷ ارزان',filters:JSON.stringify({category:'light'}),phone:'09120000000'}],
   alertAlreadySent:(alertId,listingId)=>delivered.has(`${alertId}|${listingId}`),
   recordAlertDelivery:(alertId,_u,listingId)=>delivered.add(`${alertId}|${listingId}`),
  }
  const deps={store,itemsFor:()=>[good,fair,fake],sendSms:async payload=>{sentTo.push(payload.phone);return true},now:new Date('2026-10-03T12:00:00+03:30')}
  const first=await dispatchAlerts(deps)
  expect(first.matched).toBe(1)
  expect(first.sent).toBe(1)
  const second=await dispatchAlerts(deps)
  expect(second.matched).toBe(0)
  expect(sentTo).toHaveLength(1)
 })

 it('stays silent during quiet hours',async()=>{
  const store={settings:()=>({notification_master:'true',sms_alert_enabled:'true',quiet_hours:'۲۲:۰۰ تا ۸:۰۰'}),enabledAlerts:()=>[]}
  const result=await dispatchAlerts({store,itemsFor:()=>[],now:new Date('2026-10-03T02:00:00+03:30')})
  expect(result.skipped).toBe('QUIET_HOURS')
 })
})

describe('detail enrichment',()=>{
 const rows=[{token:'t1',title:'پژو ۲۰۷',price:900*M,color:'—',km:0,year:0},{token:'t2',title:'پراید',price:300*M,color:'—',km:0,year:0}]

 it('fills colour and mileage and reports coverage',async()=>{
  const fetchImpl=async()=>({ok:true,status:200,json:async()=>({sections:[{section_name:'LIST_DATA',widgets:[{widget_type:'GROUP_INFO_ROW',data:{items:[{title:'کارکرد',value:'85,000'},{title:'رنگ',value:'سفید'},{title:'مدل',value:'1401'}]}}]}]})})
  const {items,stats}=await enrichListings(rows,{fetchImpl,delayMs:0,env:{}})
  expect(stats.fetched).toBe(2)
  expect(stats.withColor).toBe(2)
  expect(items[0].color).toBe('سفید')
  expect(items[0].km).toBe(85000)
 })

 it('reuses the cache so coverage accumulates instead of refetching',async()=>{
  let calls=0
  const fetchImpl=async()=>{calls+=1;return{ok:true,status:200,json:async()=>({sections:[]})}}
  const cache=new Map()
  const handle={get:token=>cache.get(token)||null,set:(token,fields)=>cache.set(token,fields)}
  cache.set('t1',{color:'مشکی',km:40000,year:1400})
  const {items}=await enrichListings(rows,{fetchImpl,delayMs:0,env:{},cache:handle})
  expect(items[0].color).toBe('مشکی')
  expect(calls).toBe(1)            // only the uncached token was fetched
 })

 it('never throws when the detail endpoint fails',async()=>{
  const {items}=await enrichListings(rows,{fetchImpl:async()=>{throw new Error('ECONNRESET')},delayMs:0,env:{}})
  expect(items).toHaveLength(2)
  expect(items[0].color).toBe('—')
 })
})
