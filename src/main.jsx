import React, { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { createPortal } from 'react-dom'
import { CarsPage, DashboardPage, PricingPage } from './pages'
import { AdminPage } from './admin'
import { ComparePage } from './compare-page'
import { DealerPage } from './dealer-page'
import { comparedCars, isCompared, toggleCompared } from './comparison'
import { faqItems, InfoPage, infoPaths, NotFoundPage } from './info-pages'
import { ArrowLeft, ArrowUpLeft, BarChart3, Bell, Check, ChevronDown, ChevronLeft, ChevronRight, Gauge, GitCompareArrows, Heart, Menu, Search, ShieldCheck, SlidersHorizontal, Sparkles, X } from 'lucide-react'
import { fallbackCars } from './data'
import './styles.css'
import './pages.css'
import './motion.css'
import './search.css'
import './info-pages.css'
import './admin-integrations.css'
import './admin-console.css'
import './slider.css'
import './home-refinements.css'
import './responsive-refinements.css'
import './admin-readable.css'
import './modern-icons.css'
import './compare.css'
import './public-readable.css'
import './dealer-page.css'

const toman = n => new Intl.NumberFormat('fa-IR').format(Math.round(n / 1e6))
const num = n => new Intl.NumberFormat('fa-IR').format(n)
const scoreStyle = score => ({'--score-color':`hsl(${Math.round(Math.max(0,Math.min(100,score||0))*1.25)},65%,40%)`,'--score-soft':`hsl(${Math.round(Math.max(0,Math.min(100,score||0))*1.25)},70%,94%)`})
const cardStyleFor=(car,settings={})=>car.suspicious?settings.card_suspicious||'6':car.score>=Number(settings.score_golden_min||85)?settings.card_golden||'1':car.score>=Number(settings.score_good_min||70)?settings.card_good||'2':car.score>=50?settings.card_fair||'4':settings.card_expensive||'5'
const managedLinks=(value,fallback)=>{const items=String(value||'').split('\n').map(line=>line.split('|').map(part=>part.trim())).filter(item=>item[0]&&item[1]);return items.length?items:fallback}
const tickerItems=value=>String(value||'').split('\n').map(line=>{const[title,subtitle,score]=line.split('|').map(part=>part?.trim());return{title,subtitle,score}}).filter(item=>item.title&&item.subtitle)

function Brand(){ return <a className="brand" href="/" aria-label="خودروتو"><img className="brand-logo" src="/brand/khodroto-mark.svg" alt=""/><strong>خودروتو</strong></a> }

function AnnouncementBar(){const [show,setShow]=useState(()=>sessionStorage.getItem('khodroto:announcement')!=='closed');if(!show)return null;return <div className="announcement"><Sparkles/><span><b>گزارش تازه بازار خودرو آماده است</b> — فرصت‌های زیر قیمت امروز را قبل از بقیه ببین.</span><a href="/cars">مشاهده فرصت‌ها <ArrowLeft/></a><button onClick={()=>{setShow(false);sessionStorage.setItem('khodroto:announcement','closed')}} aria-label="بستن"><X/></button></div>}

function Header({onLogin}){
  const [open,setOpen]=useState(false),[authenticated,setAuthenticated]=useState(false),[compareCount,setCompareCount]=useState(()=>comparedCars().length),[features,setFeatures]=useState({})
  useEffect(()=>{fetch('/api/settings/public').then(r=>r.json()).then(setFeatures).catch(()=>{});const count=()=>setCompareCount(comparedCars().length);window.addEventListener('khodroto:compare',count);return()=>window.removeEventListener('khodroto:compare',count)},[])
  useEffect(()=>{const sync=()=>fetch('/api/auth/me').then(response=>response.json()).then(data=>setAuthenticated(Boolean(data.user))).catch(()=>setAuthenticated(false));sync();window.addEventListener('khodroto:auth',sync);return()=>window.removeEventListener('khodroto:auth',sync)},[])
  return <header className="header"><div className="wrap nav"><Brand/><nav className={open?'open':''} onClick={()=>setOpen(false)}>
    {managedLinks(features.header_links,[['آگهی‌ها','/cars'],['مقایسه','/compare'],['روش تحلیل','/methodology'],['اشتراک','/pricing']]).filter(([,href])=>!(href==='/compare'&&features.feature_comparison==='false')&&!(href==='/pricing'&&features.feature_pricing==='false')).map(([label,href])=><a href={href} key={href}>{label}{href==='/compare'&&compareCount>0&&<i className="nav-compare-count">{compareCount}</i>}</a>)}
  </nav><div className="nav-actions">{authenticated?<a className="login auth-entry dashboard-entry" href="/dashboard">داشبورد من</a>:<button className="login auth-entry" onClick={onLogin}>ورود</button>}<a className="primary small" href="/cars">جست‌وجوی خودرو</a><button className="menu" onClick={()=>setOpen(!open)} aria-label="منو"><Menu size={22}/></button></div></div></header>
}

function Hero({stats,settings}){ const values=stats||{analyzedToday:0,totalListings:0,goldenOpportunities:0},items=tickerItems(settings?.hero_ticker),fallback=[{title:'فرصت تازه پیدا شد',subtitle:'پژو ۲۰۷ · ۱۲٪ زیر قیمت بازار',score:'۹۱'}],[ticker,setTicker]=useState(0),notices=items.length?items:fallback;useEffect(()=>{if(notices.length<2)return;const timer=setInterval(()=>setTicker(index=>(index+1)%notices.length),3800);return()=>clearInterval(timer)},[notices.length]);const notice=notices[ticker%notices.length];return <main id="top" className="hero"><div className="wrap hero-grid"><section className="hero-copy">
  <div className="eyebrow"><Sparkles size={15}/> تحلیل هوشمند آگهی‌های خودرو</div>
  <h1>{settings?.hero_title||<>ماشین خوب را<br/><em>قبل از بقیه</em> پیدا کن.</>}</h1>
  <p>{settings?.hero_description||'خودروتو آگهی‌های دیوار را بررسی می‌کند، قیمت هر خودرو را با نمونه‌های مشابه می‌سنجد و فرصت‌های واقعی را برایت جدا می‌کند.'}</p>
  <div className="hero-actions"><a className="primary" href="#search">دیدن فرصت‌های امروز <ArrowLeft size={18}/></a><a href="#method" className="text-link">خودروتو چطور کار می‌کند؟</a></div>
  <div className="trust"><span><Check/> بدون آگهی تکراری</span><span><Check/> قیمت‌گذاری شفاف</span><span><Check/> لینک مستقیم به دیوار</span></div>
  </section><section className="hero-visual"><div className="hero-image"><img src="/khodroto-market-banner.jpg" alt="مجموعه خودروهای منتخب خودروتو"/>
  <div className="floating-card ticker-card" key={ticker}><span className="pulse"/><div><b>{notice.title}</b><small>{notice.subtitle}</small></div><strong>{notice.score||'—'}</strong></div>
  <div className="image-stat"><small>آمار زنده خودروتو</small><div><b>{num(values.analyzedToday)}</b><span>بررسی‌شده امروز</span></div><div><b>{num(values.totalListings)}</b><span>کل آگهی‌های پلتفرم</span></div><div className="golden"><b>{num(values.goldenOpportunities)}</b><span>فرصت خرید طلایی</span></div></div></div></section>
  </div></main> }

function MarketSlider(){const[slides,setSlides]=useState([]),[active,setActive]=useState(0);useEffect(()=>{fetch('/api/content/slides').then(r=>r.json()).then(data=>setSlides(data.items||[])).catch(()=>{})},[]);useEffect(()=>{if(slides.length<2)return;const timer=window.setInterval(()=>setActive(index=>(index+1)%slides.length),6500);return()=>window.clearInterval(timer)},[slides.length]);if(!slides.length)return null;return <section className="market-slider-wrap"><div className="wrap"><div className="market-slider">{slides.map((slide,index)=><article key={slide.id} className={`${index===active?'active':''} theme-${slide.theme}`} style={{backgroundImage:`linear-gradient(90deg,rgba(7,18,34,.08),rgba(7,18,34,.92)),url(${slide.image})`}}><div><span><Sparkles/>{slide.badge}</span><h2>{slide.title}</h2><p>{slide.subtitle}</p><a className="primary" href={slide.cta_link||'/cars'}>{slide.cta_text||'مشاهده'} <ArrowLeft/></a></div></article>)}<div className="slider-controls"><button onClick={()=>setActive(index=>(index-1+slides.length)%slides.length)} aria-label="اسلاید قبلی"><ChevronLeft/></button><div>{slides.map((slide,index)=><button key={slide.id} className={index===active?'active':''} onClick={()=>setActive(index)} aria-label={`اسلاید ${index+1}`}/>)}</div><button onClick={()=>setActive(index=>(index+1)%slides.length)} aria-label="اسلاید بعدی"><ChevronRight/></button></div></div></div></section>}

function SearchPanel({onSearch}){
 const initial={category:'light',city:'1',brand:'همه برندها',model:'',query:'',budget:'همه قیمت‌ها',year:'همه سال‌ها',maxUsage:'',gearbox:'',body:''}
 const [form,setForm]=useState(initial),[advanced,setAdvanced]=useState(false),[catalog,setCatalog]=useState({cities:[],brands:[],models:[]});useEffect(()=>{fetch('/api/catalog/vehicles').then(r=>r.json()).then(setCatalog).catch(()=>{})},[])
 const fallbackModels={پژو:['۲۰۶','۲۰۷','پارس'], 'ایران خودرو':['دنا','تارا','رانا','سمند'],سایپا:['شاهین','کوییک','ساینا','پراید'],'مدیران خودرو':['آریزو','تیگو','ام‌وی‌ام'],هوندا:['کلیک','ویو','CB'],یاماها:['NMAX','R15','MT'],باجاج:['پالس','دومینار'],ولوو:['FH','FM'],اسکانیا:['R','G'],بنز:['آکتروس','آکسور']}
 const models={...fallbackModels,...Object.fromEntries((catalog.models||[]).map(item=>[item.brand,item.models]))}
 const brandOptions=form.category==='motorcycles'?['همه برندها','هوندا','یاماها','باجاج','کویر','بنلی']:form.category==='heavy'?['همه برندها','ولوو','اسکانیا','بنز','ایویکو','ماک']:catalog.brands?.length?['همه برندها',...catalog.brands]:['همه برندها','پژو','ایران خودرو','سایپا','مدیران خودرو','کرمان موتور','هیوندای','کیا','تویوتا']
 const set=(key,value)=>setForm({...form,[key]:value})
 const SelectField=({label,name,options,change})=><label><span>{label}</span><div><select value={form[name]} onChange={e=>change?change(e.target.value):set(name,e.target.value)}>{options.map(o=><option value={Array.isArray(o)?o[0]:o} key={Array.isArray(o)?o[0]:o}>{Array.isArray(o)?o[1]:o}</option>)}</select><ChevronDown/></div></label>
 return <section id="search" className="search-wrap"><div className="wrap"><div className="search-panel rich-search"><div className="search-heading"><div className="search-icon"><Search/></div><div><b>دنبال چه خودرویی هستی؟</b><span>جست‌وجوی دقیق میان آگهی‌های خودرو؛ همه انتخاب‌ها اختیاری‌اند</span></div><a href="/cars">جست‌وجوی حرفه‌ای <ArrowLeft/></a></div><div className="vehicle-type-tabs">{[['light','خودرو'],['motorcycles','موتورسیکلت'],['heavy','خودرو سنگین']].map(([id,label])=><button key={id} className={form.category===id?'active':''} onClick={()=>setForm({...form,category:id,brand:'همه برندها',model:''})}>{label}</button>)}</div><div className="fields main-fields"><SelectField label="شهر" name="city" options={catalog.cities?.length?catalog.cities.map(city=>[city.id,city.name]):[["1","تهران"],["2","کرج"],["3","مشهد"],["4","اصفهان"],["6","شیراز"],["5","تبریز"],["12","رشت"],["8","قم"]]}/><SelectField label="برند" name="brand" change={value=>setForm({...form,brand:value,model:''})} options={brandOptions}/><SelectField label="مدل خودرو" name="model" options={[["",form.brand==='همه برندها'?'همه مدل‌ها':'انتخاب مدل'],...(models[form.brand]||[])]}/><SelectField label="بازه قیمت" name="budget" options={['همه قیمت‌ها','تا ۵۰۰ میلیون','تا ۷۰۰ میلیون','۷۰۰ میلیون تا ۱.۲ میلیارد','۱.۲ تا ۲ میلیارد','بیشتر از ۲ میلیارد']}/><SelectField label="سال ساخت" name="year" options={['همه سال‌ها','۱۴۰۳ به بالا','۱۴۰۰ تا ۱۴۰۲','۱۳۹۵ تا ۱۳۹۹','پیش از ۱۳۹۵']}/><button onClick={()=>onSearch(form)} className="primary search-button">نمایش فرصت‌ها <Search size={18}/></button></div><button className={'advanced-toggle '+(advanced?'open':'')} onClick={()=>setAdvanced(!advanced)}><SlidersHorizontal size={16}/>{advanced?'بستن فیلترهای تکمیلی':'فیلترهای تکمیلی خودرو'}<ChevronDown size={16}/></button>{advanced&&<div className="advanced-fields"><label><span>عبارت جست‌وجوی آزاد</span><div className="search-text-field"><input value={form.query} onChange={e=>set('query',e.target.value)} placeholder="مثلاً پانوراما، کم‌کارکرد یا فول"/><Search/></div></label><SelectField label="حداکثر کارکرد" name="maxUsage" options={[["","همه کارکردها"],'۲۰٬۰۰۰','۵۰٬۰۰۰','۸۰٬۰۰۰','۱۲۰٬۰۰۰','۲۰۰٬۰۰۰']}/><SelectField label="نوع گیربکس" name="gearbox" options={[["","همه گیربکس‌ها"],'دنده‌ای','اتوماتیک']}/><SelectField label="وضعیت بدنه" name="body" options={[["","همه وضعیت‌ها"],'بدون رنگ','یک لکه رنگ','چند لکه رنگ','تصادفی']}/><button className="clear-search" onClick={()=>setForm(initial)}><X size={14}/> پاک‌کردن فیلترها</button></div>}</div></div></section>
}

function CarCard({car,index,onToast,settings}){const [compared,setCompared]=useState(()=>isCompared(car.id));
 const storageKey=`khodroto:saved:${car.id}`
 const [saved,setSaved]=useState(()=>localStorage.getItem(storageKey)!==null)
 function toggleSaved(){const next=!saved;setSaved(next);if(next)localStorage.setItem(storageKey,JSON.stringify(car));else localStorage.removeItem(storageKey);onToast(next?'آگهی در علاقه‌مندی‌ها ذخیره شد.':'آگهی از علاقه‌مندی‌ها حذف شد.')}
 return <article className={`car-card card-style-${cardStyleFor(car,settings)}`}>
 <div className="car-img"><img src={car.image || '/khodroto-hero.jpg'} style={{objectPosition:car.imagePos || 'center'}} alt={car.title}/><span className="time">{car.freshness}</span><button className={saved?'saved':''} onClick={toggleSaved} aria-label={saved?'حذف از ذخیره‌ها':'ذخیره آگهی'}><Heart fill={saved?'currentColor':'none'}/></button></div>
 <div className="car-body"><div className="card-top"><div><span className="place">{car.city}</span><h3>{car.title}</h3></div><div style={scoreStyle(car.score)} className={'score '+(car.suspicious?'suspicious':'')}><b>{num(car.score)}</b><span>{car.suspicious?'مشکوک':car.label||'امتیاز تحلیل'}</span></div></div>
 <div className="specs"><span>مدل {num(car.year)}</span><i/><span>{num(car.km)} کیلومتر</span><i/><span>{car.color}</span></div>
 <div className="prices"><div><small>قیمت آگهی</small><strong>{car.price?<>{toman(car.price)} <em>میلیون تومان</em></>:(car.priceText||'توافقی')}</strong></div><div><small>ارزش تخمینی بازار</small><del>{toman(car.market)} میلیون</del></div></div>
 <div className="saving"><span><Sparkles/> حدود {toman(car.market-car.price)} میلیون تومان به‌صرفه‌تر</span><b>{num(car.discount)}٪ زیر بازار</b></div>
 {car.suspicious&&<div className="risk-box"><ShieldCheck/> <span><b>آگهی مشکوک</b>{car.riskFlags?.[0]||'قیمت نیاز به بررسی دقیق دارد'}</span></div>}<div className="compare"><div><span style={{width:`${Math.min(94,48+car.discount*3)}%`}}/></div><small>مقایسه با {num(car.sampleSize || 24+index*7)} آگهی مشابه</small></div>
 {settings?.feature_comparison!=='false'&&<button className={`compare-card-button ${compared?'active':''}`} onClick={()=>{const result=toggleCompared(car);setCompared(isCompared(car.id));onToast(result.full?'حداکثر چهار خودرو قابل مقایسه است.':result.added?'به مقایسه اضافه شد.':'از مقایسه حذف شد.')}}><GitCompareArrows/>{compared?'انتخاب‌شده برای مقایسه':'افزودن به مقایسه'}</button>}<a className="divar-link" href={car.link} target="_blank" rel="noreferrer">مشاهده آگهی در دیوار <ArrowUpLeft/></a>
 </div></article> }

function Opportunities({cars,status,notice,loading,total,onLoadMore,onToast,settings}){const live=['kenar','divar-web'].includes(status),hasMore=cars.length<total;return <section id="opportunities" className="opps"><div className="wrap"><div className="section-head"><div><span className="kicker">فرصت‌های امروز</span><h2>ارزشمندترین‌ها، همین حالا</h2><p>{num(total)} فرصت از میان آگهی‌های کش‌شده و تحلیل‌شده.</p></div><div className={'live '+(live?'':'demo')}><span/>{loading?'در حال دریافت آگهی‌ها…':status==='kenar'?'متصل به API رسمی کنار دیوار':status==='divar-web'?'متصل مستقیم به آگهی‌های دیوار':'نسخه نمایشی با داده نمونه'}</div></div>{notice&&<div className="data-notice">{notice}</div>}<div className={`cards mobile-${settings?.mobile_listing_mode||'carousel'}`}>{cars.map((c,i)=><CarCard car={c} index={i} key={c.id} onToast={onToast} settings={settings}/>)}</div>{!cars.length&&<div className="empty">با این فیلتر فرصتی پیدا نشد؛ محدوده جست‌وجو را تغییر بده.</div>}<div className="all">{hasMore?<button className="secondary" onClick={onLoadMore} disabled={loading}>{loading?'در حال دریافت…':'مشاهده فرصت‌های بیشتر'} <ArrowLeft/></button>:cars.length>6&&<span className="all-loaded"><Check/> همه نتایج موجود نمایش داده شد</span>}<p>{live?'کش بازار هر ۱۰ دقیقه در پس‌زمینه به‌روزرسانی می‌شود':'اتصال سرور به دیوار برقرار نشد؛ داده نمونه نمایش داده شده است'}</p></div></div></section>}

function CampaignBanner({settings={}}){return <section className="campaign-wrap"><div className="wrap campaign"><img src="/khodroto-market-banner.jpg" alt="کمپین اختصاصی خودروتو"/><div className="campaign-shade"/><div className="campaign-copy"><span><Sparkles/> عضویت حرفه‌ای خودروتو</span><h2>{settings.campaign_title||'فرصت خوب منتظر نمی‌ماند.'}</h2><p>{settings.campaign_description||'هشدار لحظه‌ای، فیلترهای کامل و دسترسی به همه نتایج زیر قیمت.'}</p><a href="/pricing" className="primary">{settings.campaign_cta||'دیدن پلن‌ها'} <ArrowLeft/></a></div><div className="campaign-badge"><b>{new Intl.NumberFormat('fa-IR').format(Number(settings.campaign_discount||30))}٪</b><small>تخفیف شروع</small></div></div></section>}

function Method(){ const items=[{n:'۰۱',icon:<Search/>,title:'آگهی‌ها را پیدا می‌کنیم',text:'آگهی‌های عمومی خودرو بررسی و موارد تکراری، بدون قیمت یا ناقص حذف می‌شوند.'},{n:'۰۲',icon:<BarChart3/>,title:'قیمت را مقایسه می‌کنیم',text:'هر خودرو با مدل، سال، کارکرد، وضعیت و آگهی‌های مشابه همان شهر سنجیده می‌شود.'},{n:'۰۳',icon:<Gauge/>,title:'فرصت‌ها امتیاز می‌گیرند',text:'به‌صرفه‌ترین گزینه‌ها با امتیاز شفاف، دلیل انتخاب و لینک مستقیم نمایش داده می‌شوند.'}]
return <section id="method" className="method"><div className="wrap"><div className="center-head"><span className="kicker">فرآیند خودروتو</span><h2>از هزاران آگهی تا چند انتخاب درست</h2><p>نه حدس می‌زنیم، نه پیشنهاد تبلیغاتی می‌دهیم؛ فقط داده‌ها را قابل‌فهم می‌کنیم.</p></div><div className="steps">{items.map(x=><article key={x.n}><span className="step-num">{x.n}</span><div className="step-icon">{x.icon}</div><h3>{x.title}</h3><p>{x.text}</p></article>)}</div></div></section>}

function Score(){return <section id="score" className="score-section"><div className="wrap score-grid"><div><span className="kicker light">امتیاز خودروتو</span><h2>یک عدد ساده برای<br/>یک تصمیم مهم</h2><p>امتیاز از ترکیب فاصله قیمت با بازار، تعداد نمونه‌های مشابه، تازگی آگهی و کیفیت اطلاعات ساخته می‌شود.</p><div className="shield"><ShieldCheck/><span><b>تحلیل قابل توضیح</b><small>دلیل هر امتیاز را کنار همان خودرو می‌بینی.</small></span></div></div><div className="score-card"><div className="dial"><span>۹۱</span><small>از ۱۰۰</small></div><h3>فرصت عالی</h3><p>قیمت این خودرو با توجه به مدل، کارکرد و شهر، حدود ۱۲٪ پایین‌تر از بازار است.</p><div className="legend"><span><i className="l1"/>۸۵ تا ۱۰۰ <b>فرصت عالی</b></span><span><i className="l2"/>۷۰ تا ۸۴ <b>زیر قیمت</b></span><span><i className="l3"/>۵۰ تا ۶۹ <b>قیمت منصفانه</b></span></div></div></div></section>}

function FAQ({settings}){const [open,setOpen]=useState(0),managed=String(settings?.faq_content||'').split('\n').map(line=>{const[q,a]=line.split('|').map(x=>x?.trim());return{q,a}}).filter(item=>item.q&&item.a),items=(managed.length?managed:faqItems).slice(0,Number(settings?.faq_home_count||6));return <section id="faq" className="faq"><div className="wrap faq-grid"><div><span className="kicker">پرسش‌های پرتکرار</span><h2>پاسخ روشن، قبل از تصمیم</h2><p>درباره منبع داده، امتیاز، آگهی مشکوک و مسئولیت معامله.</p><a className="text-link faq-more" href="/faq">مشاهده همه سوالات <ArrowLeft/></a></div><div>{items.map((item,i)=><article className={open===i?'open':''} key={item.q}><button onClick={()=>setOpen(open===i?-1:i)}><b>{item.q}</b><span>{open===i?<X/>:<span>＋</span>}</span></button>{open===i&&<p>{item.a}</p>}</article>)}</div></div></section>}

function Footer({onNotify}){const[settings,setSettings]=useState({});useEffect(()=>{fetch('/api/settings/public').then(r=>r.json()).then(setSettings).catch(()=>{})},[]);const platform=managedLinks(settings.footer_platform_links,[['خودروتو چیست؟','/what-is-khodroto'],['درباره ما','/about'],['روش تحلیل','/methodology'],['منابع داده','/data-sources']]),help=managedLinks(settings.footer_help_links,[['سوالات متداول','/faq'],['تماس با ما','/contact'],['حریم خصوصی','/privacy'],['قوانین استفاده','/terms']]);return <footer><div className="wrap footer-top"><div><Brand/><p>{settings.footer_description||'موتور مستقل جست‌وجو و تحلیل بازار خودرو.'}</p></div><div><b>خودروتو</b>{platform.map(([label,href])=><a href={href} key={href}>{label}</a>)}</div><div><b>راهنما و ارتباط</b>{help.map(([label,href])=><a href={href} key={href}>{label}</a>)}</div><div className="notify"><b>فرصت خوب را از دست نده</b><p>اعلان هوشمند خودروهای منتخب</p><button onClick={onNotify}><Bell/> خبرم کن</button></div></div><div className="wrap copyright"><span>{settings.copyright_text||'© ۱۴۰۵ خودروتو — همه حقوق محفوظ است.'}</span><span className="footer-legal"><a href="/privacy">حریم خصوصی</a><a href="/terms">قوانین</a><a href="/contact">پشتیبانی</a></span></div></footer>}

function ActionModal({type,onClose,onDone}){
 const [phone,setPhone]=useState(''),[code,setCode]=useState(''),[step,setStep]=useState('phone'),[busy,setBusy]=useState(false),[debugCode,setDebugCode]=useState('')
 const title=type==='login'?'ورود به خودروتو':'فعال‌سازی اعلان هوشمند'
 async function submit(e){e.preventDefault();if(!/^09\d{9}$/.test(phone)){onDone('شماره موبایل را به‌صورت صحیح وارد کن.');return}setBusy(true);try{if(step==='phone'){const r=await fetch('/api/auth/request-otp',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({phone})}),d=await r.json();if(!r.ok)throw Error();setDebugCode(d.debugCode||'');setStep('code')}else{const r=await fetch('/api/auth/verify',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({phone,code})});if(!r.ok)throw Error();localStorage.setItem('khodroto:phone',phone);window.dispatchEvent(new Event('khodroto:auth'));if(type==='notify')await fetch('/api/alerts',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({title:'فرصت‌های منتخب من',filters:{}})});onDone(type==='login'?'با موفقیت وارد شدی.':'اعلان هوشمند فعال شد.');onClose()}}catch{onDone('عملیات انجام نشد؛ اطلاعات را بررسی کن.')}finally{setBusy(false)}}
 return createPortal(<div className="modal-backdrop" onMouseDown={e=>e.target===e.currentTarget&&onClose()}><div className="modal" role="dialog" aria-modal="true"><button className="modal-close" onClick={onClose} aria-label="بستن"><X/></button><div className="modal-icon">{type==='login'?<ShieldCheck/>:<Bell/>}</div><h3>{title}</h3><p>{type==='login'?'شماره موبایلت را وارد کن تا آگهی‌های ذخیره‌شده را نگه داری.':'شماره‌ات را ثبت کن تا فرصت‌های مطابق فیلترها را از دست ندهی.'}</p><form onSubmit={submit}><label>{step==='phone'?'شماره موبایل':'کد تأیید'}</label>{step==='phone'?<input dir="ltr" inputMode="numeric" value={phone} onChange={e=>setPhone(e.target.value.replace(/\D/g,'').slice(0,11))} placeholder="09123456789" autoFocus/>:<input dir="ltr" inputMode="numeric" value={code} onChange={e=>setCode(e.target.value.replace(/\D/g,'').slice(0,5))} placeholder="کد ۵ رقمی" autoFocus/>}<button className="primary" disabled={busy} type="submit">{busy?'در حال بررسی…':step==='phone'?'دریافت کد':'تأیید و ورود'}</button></form><small>{debugCode?`کد محیط آزمایشی: ${debugCode}`:'کد فقط دو دقیقه اعتبار دارد.'}</small></div></div>,document.body)
}

function App(){
  const [cars,setCars]=useState(()=>import.meta.env.PROD?[]:fallbackCars),[status,setStatus]=useState('demo'),[notice,setNotice]=useState(''),[loading,setLoading]=useState(true),[toast,setToast]=useState(''),[total,setTotal]=useState(fallbackCars.length),[filters,setFilters]=useState({}),[modal,setModal]=useState(null),[marketStats,setMarketStats]=useState(null),[siteSettings,setSiteSettings]=useState({})
  function showToast(message){setToast(message);window.clearTimeout(showToast.timer);showToast.timer=window.setTimeout(()=>setToast(''),3200)}
  async function loadListings(nextFilters=filters,limit=6){
    setLoading(true)
    const params=new URLSearchParams({limit:String(limit)})
    Object.entries(nextFilters).forEach(([key,value])=>{if(value&&!String(value).startsWith('همه'))params.set(key,String(value).replaceAll('٬',''))})
    try{
      const response=await fetch(`/api/listings?${params}`), data=await response.json()
      setCars(data.items||[]);setTotal(data.totalMatches??data.items?.length??0);setStatus(data.source||'demo');setNotice(data.notice||'')
    }catch{setStatus('demo');setNotice('دریافت اطلاعات ممکن نشد؛ داده نمونه نمایش داده می‌شود.')}
    finally{setLoading(false)}
  }
  useEffect(()=>{if(window.location.pathname==='/'||window.location.pathname===''){loadListings({},6);const loadStats=()=>fetch('/api/stats/public').then(r=>r.json()).then(setMarketStats).catch(()=>{});loadStats();const timer=window.setInterval(loadStats,60000);return()=>window.clearInterval(timer)}},[])
  useEffect(()=>{fetch('/api/settings/public').then(r=>r.json()).then(data=>{setSiteSettings(data);document.body.dataset.fontScale=data.public_font_scale||'normal';document.body.classList.toggle('no-motion',data.enable_motion==='false')}).catch(()=>{})},[])
  function search(nextFilters){setFilters(nextFilters);loadListings(nextFilters,6);showToast('فیلترها اعمال شدند؛ بهترین فرصت‌ها مرتب شدند.');document.querySelector('#opportunities')?.scrollIntoView({behavior:'smooth'})}
  function loadMore(){loadListings(filters,Math.min(200,cars.length+12))}
  const path=window.location.pathname.replace(/\/$/,'')||'/'
  const overlays=<>{modal&&<ActionModal type={modal} onClose={()=>setModal(null)} onDone={showToast}/>} {toast&&<div className="toast"><Check/>{toast}</div>}</>
  if(path==='/compare'&&siteSettings.feature_comparison==='false')return <><AnnouncementBar/><Header onLogin={()=>setModal('login')}/><NotFoundPage/><Footer onNotify={()=>setModal('notify')}/>{overlays}</>
  if(path==='/compare')return <><AnnouncementBar/><Header onLogin={()=>setModal('login')}/><ComparePage/>{overlays}</>
  if(path==='/cars')return <><AnnouncementBar/><Header onLogin={()=>setModal('login')}/><CarsPage onToast={showToast}/>{overlays}</>
  if(path==='/pricing'&&siteSettings.feature_pricing==='false')return <><AnnouncementBar/><Header onLogin={()=>setModal('login')}/><NotFoundPage/><Footer onNotify={()=>setModal('notify')}/>{overlays}</>
  if(path==='/pricing')return <><AnnouncementBar/><Header onLogin={()=>setModal('login')}/><PricingPage onToast={showToast}/>{overlays}</>
  if(path==='/dealer')return <><DealerPage onToast={showToast}/>{overlays}</>
  if(path==='/dashboard')return <><DashboardPage onToast={showToast}/>{overlays}</>
  if(path==='/khodroto-admin')return <><AdminPage/>{overlays}</>
  if(infoPaths.includes(path))return <><AnnouncementBar/><Header onLogin={()=>setModal('login')}/><InfoPage path={path} onToast={showToast}/><Footer onNotify={()=>setModal('notify')}/>{overlays}</>
  if(path!=='/')return <><AnnouncementBar/><Header onLogin={()=>setModal('login')}/><NotFoundPage/><Footer onNotify={()=>setModal('notify')}/>{overlays}</>
  return <><AnnouncementBar/><Header onLogin={()=>setModal('login')}/><Hero stats={marketStats} settings={siteSettings}/>{siteSettings.section_slider!=='false'&&<MarketSlider/>}{siteSettings.section_search!=='false'&&<SearchPanel onSearch={search}/>} {siteSettings.section_opportunities!=='false'&&<Opportunities cars={cars} status={status} notice={notice} loading={loading} total={total} onLoadMore={loadMore} onToast={showToast} settings={siteSettings}/>} {siteSettings.section_campaign!=='false'&&<CampaignBanner settings={siteSettings}/>}{siteSettings.section_method!=='false'&&<Method/>}{siteSettings.section_score!=='false'&&<Score/>}{siteSettings.section_faq!=='false'&&<FAQ settings={siteSettings}/>}<Footer onNotify={()=>setModal('notify')}/>{overlays}</>
}

createRoot(document.getElementById('root')).render(<App/>)
if('serviceWorker' in navigator&&import.meta.env.PROD)window.addEventListener('load',()=>navigator.serviceWorker.register('/sw.js').catch(()=>{}))
