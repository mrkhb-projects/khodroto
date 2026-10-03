import React, { useEffect, useState } from 'react'
import { ArrowLeft, ArrowUpLeft, BarChart3, Bell, Bike, Bookmark, Car, Check, ChevronDown, CreditCard, Gauge, GitCompareArrows, Heart, LayoutDashboard, MapPin, MessageCircle, Search, Settings, ShieldCheck, SlidersHorizontal, Sparkles, Store, Truck, User, X } from 'lucide-react'
import { fallbackCars } from './data'
import { isCompared, toggleCompared } from './comparison'
import { TIER_STYLE as SHARED_TIER_STYLE, tierOf, cardStyleFor, scoreStyle } from './tiers'

const num=n=>new Intl.NumberFormat('fa-IR').format(n||0)
const toman=n=>num(Math.round((n||0)/1e6))
// Province-first city picker.
// The old control rendered one flat <select> straight from the scraped Divar list,
// which showed «کل ایران» ten-plus times and mixed Tehran districts between cities.
// Now: استان → شهر, grouped and deduplicated, plus an optional "use my location"
// shortcut that snaps the browser position onto the nearest supported city.
function CityPicker({groups=[],value='',onChange,compact=false}){
 const [province,setProvince]=useState('')
 const [geoState,setGeoState]=useState('idle')
 useEffect(()=>{
  if(!value||!groups.length){return}
  const owner=groups.find(group=>group.cities.some(city=>String(city.id)===String(value)))
  if(owner)setProvince(owner.provinceId)
 },[value,groups])
 const cities=province?(groups.find(group=>group.provinceId===province)?.cities||[]):[]
 function useMyLocation(){
  if(!navigator.geolocation){setGeoState('unsupported');return}
  setGeoState('loading')
  navigator.geolocation.getCurrentPosition(async position=>{
   try{
    const {latitude,longitude}=position.coords
    const response=await fetch(`/api/locations/resolve?lat=${latitude}&lng=${longitude}`)
    if(!response.ok)throw new Error('out of coverage')
    const data=await response.json()
    setProvince(data.city.provinceId)
    onChange(String(data.city.id))
    setGeoState('done')
   }catch{setGeoState('failed')}
  },()=>setGeoState('denied'),{timeout:8000,maximumAge:600000})
 }
 return <div className={'city-picker'+(compact?' compact':'')}>
  <div className="select-box">
   <select aria-label="استان" value={province} onChange={event=>{setProvince(event.target.value);onChange('')}}>
    <option value="">همهٔ استان‌ها</option>
    {groups.map(group=><option key={group.provinceId} value={group.provinceId}>{group.province}</option>)}
   </select><ChevronDown/>
  </div>
  <div className="select-box">
   <select aria-label="شهر" value={value} onChange={event=>onChange(event.target.value)} disabled={!province}>
    <option value="">{province?'همهٔ شهرهای استان':'کل ایران'}</option>
    {cities.map(city=><option key={city.id} value={city.id}>{city.name}</option>)}
   </select><ChevronDown/>
  </div>
  <button type="button" className="geo-button" onClick={useMyLocation} disabled={geoState==='loading'}>
   <MapPin/> {geoState==='loading'?'در حال یافتن…':geoState==='denied'?'دسترسی رد شد':geoState==='failed'?'خارج از پوشش':'شهر من'}
  </button>
 </div>
}

// 90-day trend of a whole model's market value, from the daily baseline snapshots.
function MarketTrend({intel,category='light'}){
 const [points,setPoints]=useState(null)
 const cohort=intel?.cohortKey
 useEffect(()=>{
  if(!cohort){setPoints([]);return}
  let alive=true
  fetch(`/api/market/trend?category=${encodeURIComponent(category)}&cohort=${encodeURIComponent(cohort)}&days=90`)
   .then(response=>response.ok?response.json():{points:[]})
   .then(data=>{if(alive)setPoints((data.points||[]).map(row=>({value:row.median,at:row.captured_on})))})
   .catch(()=>{if(alive)setPoints([])})
  return()=>{alive=false}
 },[cohort,category])
 if(!points||points.length<2)return null
 return <div className="market-trend"><small>روند ۹۰ روزهٔ بازار</small><Sparkline points={points} height={44}/></div>
}

// Price trend sparkline. Pure SVG on purpose: a charting library would add a
// large dependency for one small graph on a market-data site that must stay fast.
function Sparkline({points=[],height=48,stroke='#2f7a4f'}){
 const values=points.map(p=>Number(p.value)||0).filter(v=>v>0)
 if(values.length<2)return null
 const min=Math.min(...values),max=Math.max(...values),span=(max-min)||1
 const width=100
 const coords=values.map((value,index)=>{
  const x=(index/(values.length-1))*width
  const y=height-((value-min)/span)*(height-8)-4
  return [Number(x.toFixed(2)),Number(y.toFixed(2))]
 })
 const line=coords.map(([x,y],index)=>`${index?'L':'M'}${x} ${y}`).join(' ')
 const area=`${line} L${width} ${height} L0 ${height} Z`
 const first=values[0],last=values[values.length-1]
 const change=first?((last-first)/first)*100:0
 return <div className="sparkline">
  <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label="روند قیمت">
   <path d={area} fill={stroke} fillOpacity="0.1"/>
   <path d={line} fill="none" stroke={stroke} strokeWidth="1.6" vectorEffect="non-scaling-stroke" strokeLinejoin="round"/>
   <circle cx={coords[coords.length-1][0]} cy={coords[coords.length-1][1]} r="2" fill={stroke} vectorEffect="non-scaling-stroke"/>
  </svg>
  <span className={change<0?'down':change>0?'up':''}>
   {change===0?'بدون تغییر':`${num(Math.abs(Math.round(change*10)/10))}٪ ${change<0?'کاهش':'افزایش'}`}
  </span>
 </div>
}

// A listing whose seller keeps cutting the price is a genuinely motivated seller —
// one of the strongest buy signals we can surface, and the price_history table was
// already being filled without anyone ever reading it.
function PriceHistory({token}){
 const [points,setPoints]=useState(null)
 useEffect(()=>{
  let alive=true
  fetch(`/api/listings/${encodeURIComponent(token)}/history`)
   .then(response=>response.ok?response.json():{items:[]})
   .then(data=>{if(alive)setPoints((data.items||[]).map(row=>({value:row.price,at:row.recorded_at})))})
   .catch(()=>{if(alive)setPoints([])})
  return()=>{alive=false}
 },[token])
 if(!points||points.length<2)return null
 const first=points[0].value,last=points[points.length-1].value
 return <div className="price-history">
  <small>روند قیمت این آگهی · {num(points.length)} تغییر</small>
  <Sparkline points={points} height={40} stroke={last<first?'#2f7a4f':'#b3321f'}/>
  <small>از {toman(first)} به {toman(last)} میلیون</small>
 </div>
}

// «چرا این امتیاز؟» — the engine already produces reason, confidence, cohort level
// and sample size; previously the card showed only a bare number. Users trust a
// score they can audit, and this is the main thing competitors do not offer.
function WhyScore({car}){
 const [open,setOpen]=useState(false)
 if(car.score==null&&!car.reason)return null
 const rows=[
  ['مبنای مقایسه',car.marketLevelLabel||'—'],
  ['تعداد نمونهٔ هم‌جنس',car.marketSamples>0?`${num(car.marketSamples)} آگهی`:'—'],
  ['میانهٔ بازار',car.market>0?`${toman(car.market)} میلیون تومان`:'—'],
  ['محدودهٔ متعارف',car.marketP25>0&&car.marketP75>0?`${toman(car.marketP25)} تا ${toman(car.marketP75)} میلیون`:'—'],
  ['فاصله از بازار',car.market>0?`${num(Math.abs(Math.round(car.discount)))}٪ ${car.discount>=0?'زیر':'بالای'} بازار`:'—'],
  ['اطمینان تحلیل',car.confidence>0?`${num(car.confidence)}٪`:'—'],
  ['قیمت مرجع',car.referencePrice>0?`${toman(car.referencePrice)} میلیون تومان`:'ثبت نشده'],
 ]
 return <div className="why-score">
  <button type="button" onClick={()=>setOpen(!open)} aria-expanded={open}>چرا این امتیاز؟ <ChevronDown className={open?'open':''}/></button>
  {open&&<div className="why-score-body">
   {car.reason&&<p>{car.reason}</p>}
   <dl>{rows.map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
   {car.priceWarnings?.length>0&&<ul className="why-warnings">{car.priceWarnings.map(warning=><li key={warning}>{warning}</li>)}</ul>}
   <PriceHistory token={car.token||car.id}/>
   <a href="/methodology">روش کامل محاسبه</a>
  </div>}
 </div>
}

const TIER_STYLE=SHARED_TIER_STYLE
// Exported so the home page shows the identical badge; a listing that reads
// «طلایی» on /cars and plain on «/» teaches users to ignore the badge.
export function TierBadge({car}){
 const tier=tierOf(car)
 if(!tier)return null
 return <span className={`tier-badge tier-${car.tier||'legacy'}`} style={{'--tier-color':tier.color}} title={car.hiddenReason||tier.label}>
  <i aria-hidden="true">{tier.marker}</i>{car.tierLabel||tier.label}{car.dealer&&<em>شرکتی</em>}
 </span>
}
const cities=[['1','تهران'],['3','مشهد'],['4','اصفهان'],['2','کرج'],['6','شیراز'],['7','اهواز'],['10','قم'],['8','تبریز'],['5','رشت']]
const parseLines=value=>String(value||'').split('\n').map(x=>x.trim()).filter(Boolean)
const parsePairs=(value,fallback)=>{const rows=parseLines(value).map(line=>line.split('|').map(x=>x.trim())).filter(row=>row.length>1);return rows.length?rows:fallback}
const brands=['همه برندها','ایران خودرو','سایپا','پژو','سمند','دنا','تارا','کوییک','شاهین','مدیران خودرو','کرمان موتور','هیوندای','کیا','تویوتا']

function ListingCard({car,onSave,settings}){const [compared,setCompared]=useState(()=>isCompared(car.id));const key=`khodroto:saved:${car.id}`, [saved,setSaved]=useState(()=>localStorage.getItem(key)!==null);function toggle(){const next=!saved;setSaved(next);next?localStorage.setItem(key,JSON.stringify(car)):localStorage.removeItem(key);onSave?.(next?'به ذخیره‌ها اضافه شد':'از ذخیره‌ها حذف شد')}
return <article className={`result-card card-style-${cardStyleFor(car,settings)}`}><div className="result-image"><img src={car.image||'/khodroto-hero.jpg'} alt={car.title}/><button className={saved?'saved':''} onClick={toggle}><Heart fill={saved?'currentColor':'none'}/></button><span>{car.freshness||'تازه'}</span></div><div className="result-content"><div className="result-title"><div><small><MapPin/> {car.city}</small><h3>{car.title}</h3><TierBadge car={car}/></div><div style={scoreStyle(car.score)} className={'mini-score '+(car.suspicious?'suspicious':'')}>{car.suspicious?'!':car.score==null?'—':num(car.score)}</div></div><div className="result-specs"><span>{car.year?`مدل ${num(car.year)}`:'سال نامشخص'}</span><span>{car.km?`${num(car.km)} کیلومتر`:'کارکرد نامشخص'}</span><span>{car.color||'—'}</span></div>{car.hidden?<div className="result-risk danger">{car.dealer?'آگهی شرکتی/نمایشگاهی':'آگهی مشکوک'}: {car.hiddenReason||car.priceWarnings?.[0]||'این مبلغ قیمت کامل خودرو نیست'}{car.referencePrice>0&&<small>قیمت مرجع بازار: {toman(car.referencePrice)} میلیون تومان</small>}</div>:car.trust==='reject'?<div className="result-risk danger">قیمت غیرواقعی: {car.priceWarnings?.[0]||'این مبلغ قیمت کامل خودرو نیست'}{car.referencePrice>0&&<small>قیمت مرجع بازار: {toman(car.referencePrice)} میلیون تومان</small>}</div>:car.trust==='review'?<div className="result-risk caution">نیازمند بررسی: {car.priceWarnings?.[0]||'قیمت با بازار هم‌خوان نیست'}</div>:car.suspicious?<div className="result-risk">مشکوک: {car.riskFlags?.[0]||'قیمت خارج از محدوده بازار'}</div>:null}<div className="result-price"><div><small>قیمت آگهی</small><b>{car.price?`${toman(car.price)} میلیون تومان`:(car.priceText||'توافقی')}</b></div>{car.market>0?<span>{num(Math.max(0,car.discount))}٪ زیر بازار</span>:<span className="no-market">داده بازار کافی نیست</span>}</div><div className="result-market"><small>میانگین بازار {car.marketLevelLabel?`(${car.marketLevelLabel})`:''}</small><b>{car.market>0?`${toman(car.market)} میلیون`:'—'}</b><small>{car.marketSamples>0?`${num(car.marketSamples)} نمونه`:''}</small></div>{car.referencePrice>0&&car.trust!=='reject'&&<div className="result-reference"><small>قیمت مرجع بازار</small><b>{toman(car.referencePrice)} میلیون</b></div>}{car.alsoOn?.length>0&&<div className="result-alsoon">این خودرو در {num(car.alsoOn.length+1)} سایت آگهی شده: {car.alsoOn.join('، ')}</div>}{car.seller&&<div className={`seller-record seller-${car.seller.grade}`}><Store/><span><b>{car.seller.name}</b><small>{car.seller.label} · {num(car.seller.listings)} آگهی{car.seller.flagged>0?` · ${num(car.seller.flagged)} مورد مشکوک`:''}</small></span></div>}<WhyScore car={car}/>{settings?.feature_comparison!=='false'&&<button className={`compare-card-button ${compared?'active':''}`} onClick={()=>{const result=toggleCompared(car);setCompared(isCompared(car.id));onSave?.(result.full?'حداکثر چهار خودرو قابل مقایسه است.':result.added?'به مقایسه اضافه شد.':'از مقایسه حذف شد.')}}><GitCompareArrows/>{compared?'انتخاب‌شده برای مقایسه':'افزودن به مقایسه'}</button>}<a href={car.link} target="_blank" rel="noreferrer">مشاهده در دیوار <ArrowUpLeft/></a></div></article>}

const fa2en=value=>String(value||'').replace(/[۰-۹]/g,d=>'۰۱۲۳۴۵۶۷۸۹'.indexOf(d))
const digitsOnly=value=>fa2en(value).replace(/\D/g,'')
function Range({label,minName,maxName,filters,setFilters,placeholder1,placeholder2}){return <div className="filter-group"><b>{label}</b><div className="range-inputs"><input inputMode="numeric" placeholder={placeholder1} value={filters[minName]||''} onChange={e=>setFilters({...filters,[minName]:digitsOnly(e.target.value)})}/><span>تا</span><input inputMode="numeric" placeholder={placeholder2} value={filters[maxName]||''} onChange={e=>setFilters({...filters,[maxName]:digitsOnly(e.target.value)})}/></div></div>}

// «ماشین من چند می‌ارزد؟» — estimate.js and /api/market/estimate were already
// complete and had no way in. This is the other side of the marketplace: the
// seller. It is also the cheapest honest lead magnet the platform has.
export function EstimatePage({onToast}){
 const [form,setForm]=useState({category:'light',title:'',year:'',km:'',color:'',body:'بدون رنگ'})
 const [result,setResult]=useState(null)
 const [loading,setLoading]=useState(false)
 const [error,setError]=useState('')

 async function submit(event){
  event.preventDefault()
  if(!form.title.trim())return onToast?.('نام برند و مدل را بنویس.')
  setLoading(true);setError('');setResult(null)
  try{
   const params=new URLSearchParams({category:form.category,title:form.title.trim()})
   if(form.year)params.set('year',digitsOnly(form.year))
   if(form.km)params.set('km',digitsOnly(form.km))
   if(form.color)params.set('color',form.color)
   if(form.body)params.set('body',form.body)
   const response=await fetch(`/api/market/estimate?${params}`)
   const data=await response.json()
   if(data.ok)setResult(data)
   else setError(data.message||'برای این خودرو دادهٔ کافی نداریم.')
  }catch{setError('ارتباط با سرور برقرار نشد.')}finally{setLoading(false)}
 }

 return <main className="inner-page estimate-page"><div className="wrap">
  <div className="center-head">
   <span className="kicker">تخمین قیمت</span>
   <h1>ماشینت چند می‌ارزد؟</h1>
   <p>بر پایهٔ آگهی‌های ۳۰ روز اخیر و قیمت‌های مرجع بازار — نه حدس.</p>
  </div>
  <form className="estimate-form" onSubmit={submit}>
   <label>دسته
    <div className="select-box"><select value={form.category} onChange={event=>setForm({...form,category:event.target.value})}>
     <option value="light">سواری و وانت</option><option value="motorcycles">موتورسیکلت</option><option value="heavy">خودرو سنگین</option>
    </select><ChevronDown/></div>
   </label>
   <label>برند و مدل<input placeholder="مثلاً پژو ۲۰۷ اتوماتیک" value={form.title} onChange={event=>setForm({...form,title:event.target.value})}/></label>
   <div className="range-inputs">
    <label>سال ساخت<input inputMode="numeric" placeholder="۱۴۰۱" value={form.year} onChange={event=>setForm({...form,year:digitsOnly(event.target.value)})}/></label>
    <label>کارکرد (کیلومتر)<input inputMode="numeric" placeholder="۸۵۰۰۰" value={form.km} onChange={event=>setForm({...form,km:digitsOnly(event.target.value)})}/></label>
   </div>
   <div className="range-inputs">
    <label>رنگ<input placeholder="سفید" value={form.color} onChange={event=>setForm({...form,color:event.target.value})}/></label>
    <label>وضعیت بدنه
     <div className="select-box"><select value={form.body} onChange={event=>setForm({...form,body:event.target.value})}>
      {['بدون رنگ','یک لکه رنگ','چند لکه رنگ','دور رنگ','تصادفی'].map(option=><option key={option}>{option}</option>)}
     </select><ChevronDown/></div>
    </label>
   </div>
   <button className="primary" disabled={loading}>{loading?'در حال محاسبه…':'تخمین قیمت'}</button>
  </form>

  {error&&<div className="estimate-empty"><ShieldCheck/><span>{error}</span></div>}

  {result&&<section className="estimate-result">
   <header>
    <small>{result.identity.label}{result.year?` · مدل ${num(result.year)}`:''}</small>
    <b>{toman(result.estimate)} میلیون تومان</b>
    <span>بازهٔ منطقی: {toman(result.range.low)} تا {toman(result.range.high)} میلیون</span>
   </header>
   <div className="estimate-confidence"><i style={{width:`${result.confidence}%`}}/><small>اعتماد تخمین: {num(result.confidence)}٪</small></div>
   <ul className="estimate-sources">
    {result.sources.map(source=><li key={source.kind+source.label}>
     <span>{source.label}</span>
     <b>{toman(source.value)} میلیون</b>
     {source.samples?<small>{num(source.samples)} نمونه</small>:null}
    </li>)}
   </ul>
   {result.adjustments.note&&<p className="estimate-note">{result.adjustments.note}</p>}
   <p className="estimate-note">این تخمین جایگزین کارشناسی حضوری نیست.</p>
   <a className="primary" href={`/cars?query=${encodeURIComponent(result.identity.label)}`}>دیدن آگهی‌های مشابه <ArrowLeft/></a>
  </section>}
 </div></main>
}

const defaultCarFilters={category:'light',city:'1',brand:'همه برندها',query:'',gearbox:'',body:'',color:'',seller:'',minPrice:'',maxPrice:'',minYear:'',maxYear:'',maxUsage:'',model:'',showHidden:''}
const budgetBands={'تا ۵۰۰ میلیون':['','500000000'],'تا ۷۰۰ میلیون':['','700000000'],'۷۰۰ میلیون تا ۱.۲ میلیارد':['700000000','1200000000'],'۱.۲ تا ۲ میلیارد':['1200000000','2000000000'],'بیشتر از ۲ میلیارد':['2000000000','']}
const yearBands={'۱۴۰۳ به بالا':['1403',''],'۱۴۰۰ تا ۱۴۰۲':['1400','1402'],'۱۳۹۵ تا ۱۳۹۹':['1395','1399'],'پیش از ۱۳۹۵':['','1394']}
function filtersFromUrl(){
 const params=new URLSearchParams(window.location.search),base={...defaultCarFilters}
 for(const key of Object.keys(base)){const value=params.get(key);if(value!=null&&value!==''&&!value.startsWith('همه'))base[key]=value}
 if(!['light','motorcycles','heavy','parts-accessories','vehicles-services'].includes(base.category))base.category='light'
 const budget=budgetBands[params.get('budget')];if(budget){base.minPrice=budget[0];base.maxPrice=budget[1]}
 const year=yearBands[params.get('year')];if(year){base.minYear=year[0];base.maxYear=year[1]}
 return base
}
function sortFromUrl(){const value=new URLSearchParams(window.location.search).get('sort');return ['score','newest','cheap','expensive'].includes(value)?value:'score'}

export function CarsPage({onToast}){
 const [filters,setFilters]=useState(filtersFromUrl),[cars,setCars]=useState([]),[total,setTotal]=useState(0),[loading,setLoading]=useState(true),[mobileFilters,setMobileFilters]=useState(false),[sort,setSort]=useState(sortFromUrl),[displaySettings,setDisplaySettings]=useState({}),[catalog,setCatalog]=useState({cities:[],categories:[],brands:[],models:[]}),[riskUnlocked,setRiskUnlocked]=useState(false),[marketIntel,setMarketIntel]=useState(null),[hiddenInfo,setHiddenInfo]=useState({hiddenCount:0,dealerCount:0,showingHidden:false,band:null})
 const segmentTree=catalog.segments?.[filters.category]||null
 const segmentBrands=segmentTree?['همه برندها',...segmentTree.brands.map(entry=>entry.brand)]:(catalog.brands?.length?['همه برندها',...catalog.brands]:brands)
 const segmentModels=segmentTree?(segmentTree.brands.find(entry=>entry.brand===filters.brand)?.models||[]):(catalog.models?.find(item=>item.brand===filters.brand)?.models||[])
 const cityGroups=catalog.cityGroups?.length?catalog.cityGroups:[],managedCities=catalog.cities?.length?catalog.cities.map(city=>[city.id,city.name]):parsePairs(displaySettings.supported_cities,cities),managedBrands=catalog.brands?.length?['همه برندها',...catalog.brands]:displaySettings.vehicle_brands?['همه برندها',...parseLines(displaySettings.vehicle_brands)]:brands,managedModels=catalog.models?.find(item=>item.brand===filters.brand)?.models||[],managedColors=displaySettings.vehicle_colors?parseLines(displaySettings.vehicle_colors):['سفید','مشکی','خاکستری','نقره‌ای','آبی']
 async function search(limit=24,base=filters){setLoading(true);const p=new URLSearchParams({limit:String(limit),city:base.city,sort});Object.entries(base).forEach(([k,v])=>{if(v&&v!=='همه برندها')p.set(k,v)});try{const r=await fetch(`/api/listings?${p}`),d=await r.json();setCars(d.items||[]);setTotal(d.totalMatches||0);setRiskUnlocked(Boolean(d.riskInsightsUnlocked));setMarketIntel(d.marketIntel||null);setHiddenInfo({hiddenCount:d.hiddenCount||0,dealerCount:d.dealerCount||0,showingHidden:Boolean(d.showingHidden),band:d.visibilityBand||null})}catch{/* The server deliberately refuses to send sample data in production; showing it from the client would undo that protection and present invented prices as real. */setCars([]);setTotal(0);setMarketIntel(null);onToast?.('ارتباط با سرور برقرار نشد؛ دوباره تلاش کن.')}finally{setLoading(false);setMobileFilters(false)}}
 const changeCategory=id=>{const next={...filters,category:id};setFilters(next);search(24,next)}
 useEffect(()=>{search();fetch('/api/settings/public').then(response=>response.json()).then(setDisplaySettings).catch(()=>{});fetch('/api/catalog/vehicles').then(response=>response.json()).then(setCatalog).catch(()=>{})},[])
 const filterPanel=<aside className={'filters-sidebar '+(mobileFilters?'show':'')}><div className="filter-head"><h3><SlidersHorizontal/> فیلترها</h3><button onClick={()=>setFilters({...defaultCarFilters})}>حذف همه</button><button className="mobile-filter-close" onClick={()=>setMobileFilters(false)}><X/></button></div><div className="filter-group"><b>استان و شهر</b><CityPicker groups={cityGroups} value={filters.city} onChange={city=>setFilters({...filters,city})}/></div><div className="filter-group"><b>برند و مدل</b><div className="select-box"><select value={filters.brand} onChange={e=>setFilters({...filters,brand:e.target.value,model:''})}>{segmentBrands.map(x=><option key={x}>{x}</option>)}</select><ChevronDown/></div></div>{segmentModels.length>0&&<div className="filter-group"><b>مدل</b><div className="select-box"><select value={filters.model||''} onChange={e=>setFilters({...filters,model:e.target.value})}><option value="">همه مدل‌ها</option>{segmentModels.map(model=><option key={model}>{model}</option>)}</select><ChevronDown/></div></div>}<Range label="قیمت (تومان)" minName="minPrice" maxName="maxPrice" filters={filters} setFilters={setFilters} placeholder1="از قیمت" placeholder2="تا قیمت"/><Range label="سال ساخت" minName="minYear" maxName="maxYear" filters={filters} setFilters={setFilters} placeholder1="مثلاً ۱۳۹۸" placeholder2="مثلاً ۱۴۰۳"/><div className="filter-group"><b>حداکثر کارکرد</b><input inputMode="numeric" placeholder="مثلاً ۸۰۰۰۰ کیلومتر" value={filters.maxUsage} onChange={e=>setFilters({...filters,maxUsage:digitsOnly(e.target.value)})}/></div><div className="filter-group"><b>گیربکس</b><div className="choice-row">{['دنده‌ای','اتوماتیک'].map(x=><button className={filters.gearbox===x?'active':''} onClick={()=>setFilters({...filters,gearbox:filters.gearbox===x?'':x})} key={x}>{x}</button>)}</div></div><div className="filter-group"><b>وضعیت بدنه</b><div className="select-box"><select value={filters.body} onChange={e=>setFilters({...filters,body:e.target.value})}><option value="">همه</option><option>بدون رنگ</option><option>یک لکه رنگ</option><option>چند لکه رنگ</option><option>تصادفی</option></select><ChevronDown/></div></div><div className="filter-group"><b>رنگ</b><div className="select-box"><select value={filters.color} onChange={e=>setFilters({...filters,color:e.target.value})}><option value="">همه رنگ‌ها</option>{managedColors.map(color=><option key={color}>{color}</option>)}</select><ChevronDown/></div></div><div className="filter-group"><b>نوع فروشنده</b><div className="choice-row">{['شخصی','نمایشگاه'].map(x=><button className={filters.seller===x?'active':''} onClick={()=>setFilters({...filters,seller:filters.seller===x?'':x})} key={x}>{x}</button>)}</div></div><label className="suspicious-toggle hidden-toggle"><input type="checkbox" checked={filters.showHidden==='true'} onChange={e=>{const next={...filters,showHidden:e.target.checked?'true':''};setFilters(next);search(24,next)}}/><span><b>نمایش آگهی‌های مشکوک و شرکتی</b><small>{hiddenInfo.hiddenCount>0?`${num(hiddenInfo.hiddenCount)} آگهی به‌دلیل اختلاف غیرعادی قیمت یا شرکتی‌بودن پنهان شده است`:`آگهی‌های بیش از ${num(hiddenInfo.band?.max||30)}٪ زیر بازار به‌صورت پیش‌فرض نمایش داده نمی‌شوند`}</small></span></label>{riskUnlocked?<label className="suspicious-toggle"><input type="checkbox" checked={filters.suspiciousOnly==='true'} onChange={e=>setFilters({...filters,suspiciousOnly:String(e.target.checked)})}/><span><b>فقط آگهی‌های مشکوک</b><small>تحلیل اختصاصی اشتراک حرفه‌ای</small></span></label>:<a className="risk-pro-lock" href="/pricing"><ShieldCheck/><span><b>تشخیص آگهی مشکوک</b><small>ویژه اعضای اشتراک پرو</small></span></a>}<button className="primary apply-filter" onClick={()=>search()}>اعمال فیلترها</button><button className="secondary apply-filter" onClick={async()=>{
  // Turning the search you already built into an alert is a one-click step; making
  // the user re-enter the same criteria in the dashboard is how alerts go unused.
  const payload={category:filters.category}
  if(filters.query)payload.query=filters.query
  if(filters.model)payload.model=filters.model
  if(filters.maxPrice)payload.maxPrice=Number(filters.maxPrice)
  if(filters.minYear)payload.minYear=Number(filters.minYear)
  try{
   const response=await fetch('/api/alerts',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({title:filters.query||filters.model||'هشدار جست‌وجو',filters:payload})})
   if(response.status===401)return onToast?.('برای ساخت هشدار ابتدا وارد شو.')
   if(response.status===409)return onToast?.('به سقف تعداد هشدارها رسیده‌ای.')
   onToast?.(response.ok?'هشدار ساخته شد؛ فرصت تازه را فوری خبر می‌دهیم.':'ساخت هشدار ناموفق بود.')
  }catch{onToast?.('ارتباط با سرور برقرار نشد.')}
 }}><Bell/> هشدار برای این جست‌وجو</button></aside>
 return <main className="cars-page"><div className="wrap"><div className="page-breadcrumb"><a href="/">خودروتو</a><span>/</span><b>آگهی‌های خودرو</b></div><div className="cars-hero"><div><span className="kicker">بازار خودرو</span><h1>خودروی مناسب تو همین‌جاست</h1><p>میان هزاران آگهی جست‌وجو کن و فرصت‌های زیر قیمت بازار را زودتر ببین.</p></div><div className="market-mini"><b>{num(total)}</b><span>فرصت قیمت‌دار</span></div></div><div className="market-categories">{[['light','سواری و وانت'],['heavy','خودرو سنگین'],['motorcycles','موتورسیکلت'],['parts-accessories','قطعات و لوازم'],['vehicles-services','خدمات خودرو']].map(([id,label])=><button key={id} className={filters.category===id?'active':''} onClick={()=>changeCategory(id)}>{id==='motorcycles'?<Bike/>:id==='heavy'?<Truck/>:<Car/>} <span>{label}</span></button>)}</div><div className="divar-search"><Search/><input value={filters.query} onChange={e=>setFilters({...filters,query:e.target.value})} onKeyDown={e=>e.key==='Enter'&&search()} placeholder="جست‌وجو در آگهی‌ها؛ مثلاً پژو ۲۰۷ اتوماتیک..."/><div className="search-city"><CityPicker compact groups={cityGroups} value={filters.city} onChange={city=>setFilters({...filters,city})}/></div><button onClick={()=>search()}>جست‌وجو</button></div><button className="mobile-filter-button" onClick={()=>setMobileFilters(true)}><SlidersHorizontal/> فیلترها</button><div className="listing-layout">{filterPanel}<section className="results">{marketIntel&&<div className="market-intel"><BarChart3/><div><b>شناسنامهٔ بازار {marketIntel.model}</b><span>میانگین <strong>{toman(marketIntel.avg)} میلیون تومان</strong>{' '}میانه {toman(marketIntel.median)} میلیون{' '}· از {num(marketIntel.total)} آگهی واقعی</span>{marketIntel.yearFocus&&<span>مدل {num(marketIntel.yearFocus.year)}: میانگین <strong>{toman(marketIntel.yearFocus.avg)} میلیون تومان</strong> ({num(marketIntel.yearFocus.samples)} نمونه)</span>}</div><MarketTrend intel={marketIntel} category={filters.category}/><a href="/methodology">روش محاسبه</a></div>}<div className="results-head"><div><b>{num(total)} آگهی</b><span>مرتب‌شده براساس بهترین فرصت</span></div><div className="select-box sort"><select value={sort} onChange={e=>{setSort(e.target.value);setTimeout(()=>search(),0)}}><option value="score">بهترین فرصت</option><option value="newest">جدیدترین</option><option value="cheap">ارزان‌ترین</option><option value="expensive">گران‌ترین</option></select><ChevronDown/></div></div>{loading?<div className="loading-grid">{[1,2,3,4,5,6].map(x=><i key={x}/>)}</div>:<div className={`results-grid mobile-${displaySettings.mobile_listing_mode||'carousel'}`}>{cars.map(c=><ListingCard key={c.id} car={c} onSave={onToast} settings={displaySettings}/>)}</div>}{!loading&&cars.length<total&&<button className="secondary load-results" onClick={()=>search(Math.min(200,cars.length+24))}>نمایش آگهی‌های بیشتر <ArrowLeft/></button>}</section></div></div></main>
}

const defaultPlans=[{id:'free',name:'رایگان',price:'۰',desc:'برای آشنایی با بازار',features:['۶ فرصت برتر','فیلترهای پایه','لینک مستقیم دیوار']},{id:'pro',name:'خودروتو پرو',price:'۱۹۹٬۰۰۰',desc:'برای خرید جدی خودرو',popular:true,features:['مشاهده همه فرصت‌ها','فیلتر کامل خودرو','ذخیره و اعلان هوشمند','تاریخچه قیمت','بدون تبلیغات']},{id:'dealer',name:'نمایشگاه حرفه‌ای',price:'۴۹۹٬۰۰۰',desc:'برای معامله‌گران و نمایشگاه‌ها',features:['پنل موجودی و قیمت هدف','مدیریت مشتری و سرنخ فروش','گزارش سود موجودی و بازار','خروجی CSV موجودی و مشتریان','۵ پایش هم‌زمان بازار']}]
export function PricingPage({onToast}){
 const[plans,setPlans]=useState(defaultPlans),[selected,setSelected]=useState(null),[method,setMethod]=useState('online'),[gateways,setGateways]=useState([]),[gatewayId,setGatewayId]=useState(null)
 useEffect(()=>{fetch('/api/plans').then(r=>r.json()).then(data=>data.items?.length&&setPlans(data.items.map(item=>({...item,desc:item.description,price:num(item.price)})))).catch(()=>{})},[])
 async function choosePlan(plan){setSelected(plan);setMethod('online');try{const data=await fetch('/api/payment/options').then(response=>response.json()),items=data.items||[];setGateways(items);setGatewayId(items[0]?.id||null)}catch{setGateways([]);setGatewayId(null)}}
 async function checkout(){const response=await fetch('/api/subscription/checkout',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({plan:selected.id,gatewayId:method==='online'?gatewayId:null})});if(response.status===401){onToast('ابتدا از دکمه ورود وارد حساب شو.');return}const data=await response.json();onToast(data.mode==='sandbox'?'اشتراک آزمایشی با موفقیت فعال شد.':`درگاه «${data.gateway?.name||'آنلاین'}» برای پرداخت انتخاب شد.`);setSelected(null)}
 return <main className="inner-page pricing-page"><div className="wrap"><div className="center-head"><span className="kicker">اشتراک خودروتو</span><h1>هر فرصت خوب، چند برابر اشتراک می‌ارزد</h1><p>بدون تمدید خودکار؛ هر زمان خواستی پلن را ارتقا بده.</p></div><div className="plans">{plans.map(plan=><article className={plan.popular?'popular':''} key={plan.id}>{plan.popular&&<span className="popular-badge">پیشنهاد خریداران</span>}<h3>{plan.name}</h3><p>{plan.desc}</p><div className="plan-price"><b>{plan.price}</b><span>تومان / ماه</span></div><ul>{plan.features.map(feature=><li key={feature}><Check/>{feature}</li>)}</ul><button className={plan.popular?'primary':'secondary'} onClick={()=>plan.id==='free'?onToast('پلن رایگان همین حالا برای شما فعال است.'):choosePlan(plan)}>انتخاب پلن</button></article>)}</div><div className="payment-trust"><ShieldCheck/><span><b>پرداخت امن و شفاف</b><small>اطلاعات پرداخت در خودروتو ذخیره نمی‌شود.</small></span><CreditCard/><span><b>بدون تمدید خودکار</b><small>پس از پایان دوره خودت تصمیم می‌گیری.</small></span></div></div>{selected&&<div className="checkout-overlay"><div className="checkout"><button onClick={()=>setSelected(null)}><X/></button><h3>تکمیل خرید {selected.name}</h3><div className="order-row"><span>اشتراک ۳۰ روزه</span><b>{selected.price} تومان</b></div><label>روش پرداخت</label><div className="payment-methods"><button className={method==='online'?'active':''} onClick={()=>setMethod('online')}><CreditCard/> درگاه آنلاین</button><button className={method==='card'?'active':''} onClick={()=>setMethod('card')}><Bookmark/> کارت‌به‌کارت</button></div>{method==='online'&&gateways.length>0&&<div className="gateway-options"><label>انتخاب درگاه</label>{gateways.map(gateway=><button key={gateway.id} className={gatewayId===gateway.id?'active':''} onClick={()=>setGatewayId(gateway.id)}><CreditCard/><span><b>{gateway.name}</b><small>{gateway.provider}</small></span>{gatewayId===gateway.id&&<Check/>}</button>)}</div>}{method==='online'&&!gateways.length&&<div className="payment-hint">درگاه فعالی ثبت نشده؛ پرداخت در محیط آزمایشی انجام می‌شود.</div>}<input placeholder="کد تخفیف (اختیاری)"/><button className="primary pay" onClick={checkout}>پرداخت {selected.price} تومان</button><small>با پرداخت، قوانین استفاده از خودروتو را می‌پذیرید.</small></div></div>}</main>
}

const dashboardTabs=[['overview','نمای کلی',LayoutDashboard],['saved','ذخیره‌شده‌ها',Heart],['alerts','هشدارهای من',Bell],['searches','جست‌وجوهای ذخیره‌شده',Search],['subscription','اشتراک',CreditCard],['account','حساب کاربری',User],['support','پشتیبانی',MessageCircle]]
// Saved alerts — the matcher in src/server/alerts.js has always been able to find
// a fresh opportunity and queue an SMS; until now nothing in the UI could create
// the alert it was supposed to match. This panel is that missing half.
function AlertsPanel({onToast}){
 const [items,setItems]=useState(null)
 const [history,setHistory]=useState([])
 const [title,setTitle]=useState('')
 const [draft,setDraft]=useState({category:'light',query:'',maxPrice:'',minYear:''})
 const [busy,setBusy]=useState(false)
 const [authed,setAuthed]=useState(true)

 const load=async()=>{
  try{
   const response=await fetch('/api/alerts')
   if(response.status===401){setAuthed(false);setItems([]);return}
   const data=await response.json();setItems(data.items||[]);setAuthed(true)
  }catch{setItems([])}
  try{const response=await fetch('/api/alerts/history');if(response.ok){const data=await response.json();setHistory(data.items||[])}}catch{}
 }
 useEffect(()=>{load()},[])

 async function create(event){
  event.preventDefault()
  setBusy(true)
  try{
   const filters={category:draft.category}
   if(draft.query.trim())filters.query=draft.query.trim()
   if(draft.maxPrice)filters.maxPrice=Number(digitsOnly(draft.maxPrice))
   if(draft.minYear)filters.minYear=Number(digitsOnly(draft.minYear))
   const response=await fetch('/api/alerts',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({title:title||draft.query||'هشدار خودرو',filters})})
   if(response.status===401){setAuthed(false);onToast?.('برای ساخت هشدار ابتدا وارد شو.');return}
   if(response.status===409){const data=await response.json();onToast?.(`حداکثر ${num(data.limit)} هشدار می‌توانی داشته باشی.`);return}
   if(!response.ok)throw new Error('failed')
   setTitle('');setDraft({category:'light',query:'',maxPrice:'',minYear:''})
   onToast?.('هشدار ساخته شد؛ به‌محض پیدا شدن فرصت خبرت می‌کنیم.')
   await load()
  }catch{onToast?.('ساخت هشدار ناموفق بود.')}finally{setBusy(false)}
 }

 async function toggle(alert){
  setItems(list=>list.map(entry=>entry.id===alert.id?{...entry,enabled:alert.enabled?0:1}:entry))
  try{await fetch(`/api/alerts/${alert.id}`,{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({enabled:!alert.enabled})})}catch{load()}
 }
 async function remove(alert){
  try{const response=await fetch(`/api/alerts/${alert.id}`,{method:'DELETE'});if(response.ok){onToast?.('هشدار حذف شد.');load()}}catch{onToast?.('حذف هشدار ناموفق بود.')}
 }

 const describe=alert=>{
  let filters={}
  try{filters=JSON.parse(alert.filters||'{}')}catch{}
  const parts=[]
  if(filters.query)parts.push(filters.query)
  if(filters.maxPrice)parts.push(`تا ${toman(filters.maxPrice)} میلیون`)
  if(filters.minYear)parts.push(`مدل ${num(filters.minYear)} به بالا`)
  return parts.length?parts.join(' · '):'همهٔ فرصت‌های این دسته'
 }

 return <DashSection title="هشدارهای هوشمند" desc="هر وقت فرصت تازه‌ای مطابق معیارها پیدا شد، همان لحظه خبرت می‌کنیم.">
  {!authed&&<div className="hidden-notice">برای ساخت و مدیریت هشدار باید وارد حساب شوی.</div>}
  {items===null?<div className="hidden-notice">در حال بارگذاری…</div>
   :items.length===0?<Empty icon={<Bell/>} text="هنوز هشداری نساخته‌ای. اولین هشدار را پایین بساز." action="مشاهده آگهی‌ها" href="/cars"/>
   :items.map(alert=><div className="alert-row" key={alert.id}>
     <div><Bell/><span><b>{alert.title}</b><small>{describe(alert)}</small></span></div>
     <div className="alert-row-actions">
      <button className={alert.enabled?'switch on':'switch'} onClick={()=>toggle(alert)} aria-label="روشن/خاموش"><i/></button>
      <button className="alert-delete" onClick={()=>remove(alert)} aria-label="حذف هشدار"><X/></button>
     </div>
    </div>)}
  <form className="alert-create" onSubmit={create}>
   <b>ساخت هشدار تازه</b>
   <input placeholder="نام هشدار (اختیاری)" value={title} onChange={event=>setTitle(event.target.value)}/>
   <input placeholder="مثلاً پژو ۲۰۷ اتوماتیک" value={draft.query} onChange={event=>setDraft({...draft,query:event.target.value})}/>
   <div className="range-inputs">
    <input inputMode="numeric" placeholder="حداکثر قیمت (تومان)" value={draft.maxPrice} onChange={event=>setDraft({...draft,maxPrice:digitsOnly(event.target.value)})}/>
    <input inputMode="numeric" placeholder="از سال" value={draft.minYear} onChange={event=>setDraft({...draft,minYear:digitsOnly(event.target.value)})}/>
   </div>
   <button className="primary" disabled={busy}>{busy?'در حال ثبت…':'＋ ساخت هشدار'}</button>
  </form>
  {history.length>0&&<div className="alert-history">
   <b>آخرین اعلان‌ها</b>
   {history.slice(0,8).map(entry=><div className="alert-history-row" key={entry.id}>
    <span>{entry.message}</span>
    <small>{entry.status==='sent'?'ارسال شد':'در صف ارسال'}</small>
   </div>)}
  </div>}
 </DashSection>
}

export function DashboardPage({onToast}){const [tab,setTab]=useState('overview'),[name,setName]=useState(()=>localStorage.getItem('khodroto:name')||'کاربر خودروتو'),[phone,setPhone]=useState(()=>localStorage.getItem('khodroto:phone')||'۰۹۱۲•••••••'),[alerts,setAlerts]=useState([true,true,false]);const [overview,setOverview]=useState({alerts:null,opportunities:null,cars:null,savedSearches:null,plan:'رایگان'}),[subscription,setSubscription]=useState(null)
 // Everything on this screen used to be invented: "۲ هشدار فعال", "۳۴ فرصت تازه"
 // and two sample cars presented as today's recommendations. Showing a signed-in
 // user made-up listings with made-up prices is worse than showing nothing.
 useEffect(()=>{
  let alive=true
  const readJson=async url=>{try{const response=await fetch(url);return response.ok?await response.json():null}catch{return null}}
  Promise.all([readJson('/api/alerts'),readJson('/api/listings?limit=4&sort=score'),readJson('/api/subscription')]).then(([alertData,listingData,subscriptionData])=>{
   if(!alive)return
   const alerts=alertData?.items||null
   const describe=raw=>{let f={};try{f=JSON.parse(raw||'{}')}catch{}
    const parts=[]
    if(f.query)parts.push(f.query)
    if(f.maxPrice)parts.push(`تا ${toman(f.maxPrice)} میلیون`)
    if(f.minYear)parts.push(`مدل ${num(f.minYear)} به بالا`)
    return{summary:parts.length?parts.join(' · '):'همهٔ فرصت‌های این دسته',href:`/cars?${new URLSearchParams(Object.fromEntries(Object.entries(f).filter(([,v])=>v!=null&&v!=='').map(([k,v])=>[k,String(v)])))}`}}
   setOverview({
    alerts:alerts?alerts.filter(item=>item.enabled).length:null,
    opportunities:listingData?Number(listingData.totalMatches||0):null,
    cars:listingData?.items?.slice(0,2)||[],
    savedSearches:alerts?alerts.map(item=>({id:item.id,title:item.title,...describe(item.filters)})):null,
    plan:subscriptionData?.subscription?.status==='active'?subscriptionData.subscription.plan:'رایگان',
   })
   setSubscription(subscriptionData?.subscription||false)
  })
  return()=>{alive=false}
 },[])
 const saved=Array.from({length:localStorage.length},(_,i)=>localStorage.key(i)).filter(k=>k?.startsWith('khodroto:saved:')).map(k=>{try{return JSON.parse(localStorage.getItem(k))}catch{return null}}).filter(item=>item&&item.id);function content(){if(tab==='saved')return <DashSection title="خودروهای ذخیره‌شده" desc="آگهی‌هایی که برای بررسی دوباره نگه داشته‌ای.">{saved.length?<div className="dash-cars">{saved.map(c=><ListingCard car={c} key={c.id} onSave={onToast}/>)}</div>:<Empty icon={<Heart/>} text="هنوز آگهی‌ای ذخیره نکرده‌ای." action="مشاهده آگهی‌ها" href="/cars"/>}</DashSection>;if(tab==='alerts')return <AlertsPanel onToast={onToast}/>;if(tab==='searches')return <DashSection title="جست‌وجوهای ذخیره‌شده" desc="هر هشداری که ساخته‌ای یک جست‌وجوی ذخیره‌شده هم هست.">{overview.savedSearches===null?<div className="hidden-notice">در حال بارگذاری…</div>:overview.savedSearches.length?overview.savedSearches.map(item=><div className="saved-search" key={item.id}><Search/><div><b>{item.title}</b><small>{item.summary}</small></div><a href={item.href}>اجرای جست‌وجو <ArrowLeft/></a></div>):<Empty icon={<Search/>} text="هنوز جست‌وجویی ذخیره نکرده‌ای." action="ساخت هشدار" href="/cars"/>}</DashSection>;if(tab==='subscription')return <DashSection title="اشتراک من" desc="وضعیت پلن و صورت‌حساب‌های خودروتو."><div className="current-plan"><Sparkles/><div><b>{subscription===null?'در حال بارگذاری…':subscription&&subscription.status==='active'?`پلن ${subscription.plan}`:'پلن رایگان'}</b><span>{subscription&&subscription.status==='active'&&subscription.expires_at?`فعال تا ${new Date(subscription.expires_at).toLocaleDateString('fa-IR')}`:'۶ فرصت برتر و فیلترهای پایه'}</span></div>{subscription&&subscription.status==='active'?<a className="secondary" href="/pricing">تمدید یا تغییر پلن</a>:<a className="primary" href="/pricing">ارتقا به پرو</a>}</div></DashSection>;if(tab==='account')return <DashSection title="اطلاعات حساب" desc="مشخصات و تنظیمات شخصی خودت را مدیریت کن."><form className="account-form" onSubmit={async e=>{e.preventDefault();const r=await fetch('/api/user',{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({name,city:'1'})});if(r.ok){localStorage.setItem('khodroto:name',name);onToast('اطلاعات حساب ذخیره شد.')}else onToast('برای ذخیره اطلاعات ابتدا وارد شو.')}}><label>نام و نام خانوادگی<input value={name} onChange={e=>setName(e.target.value)}/></label><label>شماره موبایل<input dir="ltr" value={phone} onChange={e=>setPhone(e.target.value)}/></label><label>شهر پیش‌فرض<select><option>تهران</option><option>کرج</option><option>مشهد</option></select></label><button className="primary">ذخیره تغییرات</button></form></DashSection>;if(tab==='support')return <DashSection title="پشتیبانی" desc="سؤال یا مشکلی داری؟ برای ما بنویس."><form className="account-form" onSubmit={async e=>{e.preventDefault();const fd=new FormData(e.currentTarget),r=await fetch('/api/support',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({subject:fd.get('subject'),message:fd.get('message')})});onToast(r.ok?'درخواست پشتیبانی ثبت شد.':'برای ثبت درخواست ابتدا وارد شو.');if(r.ok)e.currentTarget.reset()}}><label>موضوع<select name="subject"><option>مشکل فنی</option><option>اشتراک و پرداخت</option><option>گزارش آگهی</option></select></label><label>پیام<textarea name="message" required rows="5" placeholder="مشکل را با جزئیات بنویس..."/></label><button className="primary">ارسال درخواست</button></form></DashSection>;return <><div className="dash-welcome"><div><span>سلام، {name} 👋</span><h1>امروز چه ماشینی پیدا کنیم؟</h1></div><a className="primary" href="/cars">جست‌وجوی خودرو <Search/></a></div><div className="dash-stats"><article><Heart/><span><b>{num(saved.length)}</b><small>ذخیره‌شده</small></span></article><article><Bell/><span><b>{overview.alerts==null?'—':num(overview.alerts)}</b><small>هشدار فعال</small></span></article><article><Gauge/><span><b>{overview.opportunities==null?'—':num(overview.opportunities)}</b><small>فرصت امروز</small></span></article><article><Sparkles/><span><b>{overview.plan}</b><small>پلن فعلی</small></span></article></div><DashSection title="فرصت‌های امروز" desc="بهترین آگهی‌های زیر قیمت بازار، همین حالا">{overview.cars===null?<div className="hidden-notice">در حال بارگذاری…</div>:overview.cars.length?<div className="dash-cars">{overview.cars.map(c=><ListingCard car={c} key={c.id} onSave={onToast}/>)}</div>:<Empty icon={<Gauge/>} text="همین حالا فرصت تازه‌ای در بازار نیست." action="جست‌وجوی خودرو" href="/cars"/>}</DashSection></>}
return <main className="dashboard-page"><div className="wrap dashboard-layout"><aside className="dash-sidebar"><div className="dash-user"><div>{name.slice(0,1)}</div><span><b>{name}</b><small>{phone}</small></span></div>{dashboardTabs.map(([id,label,Icon])=><button className={tab===id?'active':''} onClick={()=>setTab(id)} key={id}><Icon/>{label}</button>)}<a className="dealer-dashboard-link" href="/dealer"><Store/> ابزارهای نمایشگاه</a><a href="/"><ArrowLeft/> بازگشت به سایت</a></aside><section className="dash-main">{content()}</section></div></main>}
function DashSection({title,desc,children}){return <section className="dash-section"><div className="dash-section-head"><div><h2>{title}</h2><p>{desc}</p></div></div>{children}</section>}
function Empty({icon,text,action,href}){return <div className="dash-empty">{icon}<b>{text}</b><a href={href}>{action}<ArrowLeft/></a></div>}
