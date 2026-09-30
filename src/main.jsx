import React, { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { ArrowLeft, ArrowUpLeft, BarChart3, Bell, Check, ChevronDown, Gauge, Heart, Menu, Search, ShieldCheck, Sparkles, X } from 'lucide-react'
import { fallbackCars } from './data'
import './styles.css'

const toman = n => new Intl.NumberFormat('fa-IR').format(Math.round(n / 1e6))
const num = n => new Intl.NumberFormat('fa-IR').format(n)

function Brand(){ return <a className="brand" href="#top" aria-label="خودروتو"><span className="brand-mark"><span /></span><strong>خودروتو</strong></a> }

function Header({onLogin}){
  const [open,setOpen]=useState(false)
  return <header className="header"><div className="wrap nav"><Brand/><nav className={open?'open':''} onClick={()=>setOpen(false)}>
    <a href="#opportunities">فرصت‌های خرید</a><a href="#method">چطور کار می‌کند؟</a><a href="#score">راهنمای امتیاز</a><a href="#faq">پرسش‌ها</a>
  </nav><div className="nav-actions"><button className="login" onClick={onLogin}>ورود</button><a className="primary small" href="#search">جست‌وجوی خودرو</a><button className="menu" onClick={()=>setOpen(!open)} aria-label="منو"><Menu size={22}/></button></div></div></header>
}

function Hero(){ return <main id="top" className="hero"><div className="wrap hero-grid"><section className="hero-copy">
  <div className="eyebrow"><Sparkles size={15}/> تحلیل هوشمند آگهی‌های خودرو</div>
  <h1>ماشین خوب را<br/><em>قبل از بقیه</em> پیدا کن.</h1>
  <p>خودروتو آگهی‌های دیوار را بررسی می‌کند، قیمت هر خودرو را با نمونه‌های مشابه می‌سنجد و فرصت‌های واقعی را برایت جدا می‌کند.</p>
  <div className="hero-actions"><a className="primary" href="#search">دیدن فرصت‌های امروز <ArrowLeft size={18}/></a><a href="#method" className="text-link">خودروتو چطور کار می‌کند؟</a></div>
  <div className="trust"><span><Check/> بدون آگهی تکراری</span><span><Check/> قیمت‌گذاری شفاف</span><span><Check/> لینک مستقیم به دیوار</span></div>
  </section><section className="hero-visual"><div className="hero-image"><img src="/khodroto-hero.jpg" alt="خودروهای منتخب در پارکینگ شهری"/>
  <div className="floating-card"><span className="pulse"/><div><b>فرصت تازه پیدا شد</b><small>پژو ۲۰۷ · ۱۲٪ زیر قیمت بازار</small></div><strong>۹۱</strong></div>
  <div className="image-stat"><b>۲٬۴۸۶</b><span>آگهی بررسی‌شده امروز</span></div></div></section>
  </div></main> }

function SearchPanel({onSearch}){
 const [brand,setBrand]=useState('همه برندها'); const [budget,setBudget]=useState('همه قیمت‌ها'); const [year,setYear]=useState('همه سال‌ها')
 const selects=[['برند و مدل',brand,setBrand,['همه برندها','پژو','ایران خودرو','سایپا','مدیران خودرو']],['بازه قیمت',budget,setBudget,['همه قیمت‌ها','تا ۷۰۰ میلیون','۷۰۰ میلیون تا ۱.۲ میلیارد','بیشتر از ۱.۲ میلیارد']],['سال ساخت',year,setYear,['همه سال‌ها','۱۴۰۳ به بالا','۱۴۰۰ تا ۱۴۰۲','پیش از ۱۴۰۰']]]
 return <section id="search" className="search-wrap"><div className="wrap"><div className="search-panel"><div className="search-heading"><div className="search-icon"><Search/></div><div><b>دنبال چه خودرویی هستی؟</b><span>انتخاب‌ها اختیاری هستند</span></div></div><div className="fields">{selects.map(([label,value,setter,options])=><label key={label}><span>{label}</span><div><select value={value} onChange={e=>setter(e.target.value)}>{options.map(o=><option key={o}>{o}</option>)}</select><ChevronDown/></div></label>)}<button onClick={()=>onSearch({brand,budget,year})} className="primary search-button">نمایش فرصت‌ها <Search size={18}/></button></div></div></div></section>
}

function CarCard({car,index,onToast}){
 const storageKey=`khodroto:saved:${car.id}`
 const [saved,setSaved]=useState(()=>localStorage.getItem(storageKey)==='1')
 function toggleSaved(){const next=!saved;setSaved(next);if(next)localStorage.setItem(storageKey,'1');else localStorage.removeItem(storageKey);onToast(next?'آگهی در علاقه‌مندی‌ها ذخیره شد.':'آگهی از علاقه‌مندی‌ها حذف شد.')}
 return <article className="car-card">
 <div className="car-img"><img src={car.image || '/khodroto-hero.jpg'} style={{objectPosition:car.imagePos || 'center'}} alt={car.title}/><span className="time">{car.freshness}</span><button className={saved?'saved':''} onClick={toggleSaved} aria-label={saved?'حذف از ذخیره‌ها':'ذخیره آگهی'}><Heart fill={saved?'currentColor':'none'}/></button></div>
 <div className="car-body"><div className="card-top"><div><span className="place">{car.city}</span><h3>{car.title}</h3></div><div className={'score '+(car.score>=85?'gold':'')}><b>{num(car.score)}</b><span>{car.score>=85?'فرصت عالی':'زیر قیمت'}</span></div></div>
 <div className="specs"><span>مدل {num(car.year)}</span><i/><span>{num(car.km)} کیلومتر</span><i/><span>{car.color}</span></div>
 <div className="prices"><div><small>قیمت آگهی</small><strong>{toman(car.price)} <em>میلیون تومان</em></strong></div><div><small>ارزش تخمینی بازار</small><del>{toman(car.market)} میلیون</del></div></div>
 <div className="saving"><span><Sparkles/> حدود {toman(car.market-car.price)} میلیون تومان به‌صرفه‌تر</span><b>{num(car.discount)}٪ زیر بازار</b></div>
 <div className="compare"><div><span style={{width:`${Math.min(94,48+car.discount*3)}%`}}/></div><small>مقایسه با {num(car.sampleSize || 24+index*7)} آگهی مشابه</small></div>
 <a className="divar-link" href={car.link} target="_blank" rel="noreferrer">مشاهده آگهی در دیوار <ArrowUpLeft/></a>
 </div></article> }

function Opportunities({cars,status,notice,loading,total,onLoadMore,onToast}){const live=['kenar','divar-web'].includes(status),hasMore=cars.length<total;return <section id="opportunities" className="opps"><div className="wrap"><div className="section-head"><div><span className="kicker">فرصت‌های امروز</span><h2>ارزشمندترین‌ها، همین حالا</h2><p>{num(total)} فرصت از میان آگهی‌های کش‌شده و تحلیل‌شده.</p></div><div className={'live '+(live?'':'demo')}><span/>{loading?'در حال دریافت آگهی‌ها…':status==='kenar'?'متصل به API رسمی کنار دیوار':status==='divar-web'?'متصل مستقیم به آگهی‌های دیوار':'نسخه نمایشی با داده نمونه'}</div></div>{notice&&<div className="data-notice">{notice}</div>}<div className="cards">{cars.map((c,i)=><CarCard car={c} index={i} key={c.id} onToast={onToast}/>)}</div>{!cars.length&&<div className="empty">با این فیلتر فرصتی پیدا نشد؛ محدوده جست‌وجو را تغییر بده.</div>}<div className="all">{hasMore?<button className="secondary" onClick={onLoadMore} disabled={loading}>{loading?'در حال دریافت…':'مشاهده فرصت‌های بیشتر'} <ArrowLeft/></button>:cars.length>6&&<span className="all-loaded"><Check/> همه نتایج موجود نمایش داده شد</span>}<p>{live?'کش بازار هر ۱۰ دقیقه در پس‌زمینه به‌روزرسانی می‌شود':'اتصال سرور به دیوار برقرار نشد؛ داده نمونه نمایش داده شده است'}</p></div></div></section>}

function Method(){ const items=[{n:'۰۱',icon:<Search/>,title:'آگهی‌ها را پیدا می‌کنیم',text:'آگهی‌های عمومی خودرو بررسی و موارد تکراری، بدون قیمت یا ناقص حذف می‌شوند.'},{n:'۰۲',icon:<BarChart3/>,title:'قیمت را مقایسه می‌کنیم',text:'هر خودرو با مدل، سال، کارکرد، وضعیت و آگهی‌های مشابه همان شهر سنجیده می‌شود.'},{n:'۰۳',icon:<Gauge/>,title:'فرصت‌ها امتیاز می‌گیرند',text:'به‌صرفه‌ترین گزینه‌ها با امتیاز شفاف، دلیل انتخاب و لینک مستقیم نمایش داده می‌شوند.'}]
return <section id="method" className="method"><div className="wrap"><div className="center-head"><span className="kicker">فرآیند خودروتو</span><h2>از هزاران آگهی تا چند انتخاب درست</h2><p>نه حدس می‌زنیم، نه پیشنهاد تبلیغاتی می‌دهیم؛ فقط داده‌ها را قابل‌فهم می‌کنیم.</p></div><div className="steps">{items.map(x=><article key={x.n}><span className="step-num">{x.n}</span><div className="step-icon">{x.icon}</div><h3>{x.title}</h3><p>{x.text}</p></article>)}</div></div></section>}

function Score(){return <section id="score" className="score-section"><div className="wrap score-grid"><div><span className="kicker light">امتیاز خودروتو</span><h2>یک عدد ساده برای<br/>یک تصمیم مهم</h2><p>امتیاز از ترکیب فاصله قیمت با بازار، تعداد نمونه‌های مشابه، تازگی آگهی و کیفیت اطلاعات ساخته می‌شود.</p><div className="shield"><ShieldCheck/><span><b>تحلیل قابل توضیح</b><small>دلیل هر امتیاز را کنار همان خودرو می‌بینی.</small></span></div></div><div className="score-card"><div className="dial"><span>۹۱</span><small>از ۱۰۰</small></div><h3>فرصت عالی</h3><p>قیمت این خودرو با توجه به مدل، کارکرد و شهر، حدود ۱۲٪ پایین‌تر از بازار است.</p><div className="legend"><span><i className="l1"/>۸۵ تا ۱۰۰ <b>فرصت عالی</b></span><span><i className="l2"/>۷۰ تا ۸۴ <b>زیر قیمت</b></span><span><i className="l3"/>۵۰ تا ۶۹ <b>قیمت منصفانه</b></span></div></div></div></section>}

function FAQ(){const qs=['اطلاعات خودروها از کجا می‌آید؟','امتیاز خودروتو چطور محاسبه می‌شود؟','آیا خودروتو فروشنده خودرو است؟']; const [open,setOpen]=useState(0); return <section id="faq" className="faq"><div className="wrap faq-grid"><div><span className="kicker">پرسش‌های پرتکرار</span><h2>چیزی مبهم مانده؟</h2><p>قبل از تماس یا معامله، اطلاعات آگهی و سلامت خودرو را مستقلاً بررسی کن.</p></div><div>{qs.map((q,i)=><article className={open===i?'open':''} key={q}><button onClick={()=>setOpen(open===i?-1:i)}><b>{q}</b><span>{open===i?<X/>:<span>＋</span>}</span></button>{open===i&&<p>{i===0?'در نسخه عملیاتی، داده‌های آگهی‌های عمومی دیوار از مسیر مجاز دریافت، پالایش و تحلیل می‌شوند. این پیش‌نمایش برای ارزیابی تجربه کاربری از داده نمونه استفاده می‌کند.':i===1?'فاصله قیمت با خودروهای هم‌مدل، سال ساخت، کارکرد، شهر، تازگی آگهی و میزان اطمینان داده در امتیاز مؤثر است.':'خیر. خودروتو فقط موتور جست‌وجو و تحلیل آگهی است و در خرید، فروش یا کارشناسی خودرو دخالتی ندارد.'}</p>}</article>)}</div></div></section>}

function Footer({onNotify}){return <footer><div className="wrap footer-top"><div><Brand/><p>ماشین خوب، قیمت درست.</p></div><div><b>خودروتو</b><a href="#method">درباره ما</a><a href="#faq">پرسش‌ها</a></div><div><b>سرویس</b><a href="#opportunities">فرصت‌ها</a><a href="#score">راهنمای امتیاز</a></div><div className="notify"><b>فرصت خوب را از دست نده</b><p>اعلان هوشمند خودروهای منتخب</p><button onClick={onNotify}><Bell/> خبرم کن</button></div></div><div className="wrap copyright"><span>© ۱۴۰۵ خودروتو — همه حقوق محفوظ است.</span><span>ساخته‌شده برای خرید آگاهانه</span></div></footer>}

function ActionModal({type,onClose,onDone}){
 const [phone,setPhone]=useState('')
 const title=type==='login'?'ورود به خودروتو':'فعال‌سازی اعلان هوشمند'
 function submit(e){e.preventDefault();if(!/^09\d{9}$/.test(phone)){onDone('شماره موبایل را به‌صورت صحیح وارد کن.');return}localStorage.setItem('khodroto:phone',phone);onDone(type==='login'?'شماره ثبت شد؛ ورود پیامکی در نسخه بعدی فعال می‌شود.':'اعلان برای این شماره فعال شد.');onClose()}
 return <div className="modal-backdrop" onMouseDown={e=>e.target===e.currentTarget&&onClose()}><div className="modal" role="dialog" aria-modal="true"><button className="modal-close" onClick={onClose} aria-label="بستن"><X/></button><div className="modal-icon">{type==='login'?<ShieldCheck/>:<Bell/>}</div><h3>{title}</h3><p>{type==='login'?'شماره موبایلت را وارد کن تا آگهی‌های ذخیره‌شده را نگه داری.':'شماره‌ات را ثبت کن تا فرصت‌های مطابق فیلترها را از دست ندهی.'}</p><form onSubmit={submit}><label>شماره موبایل</label><input dir="ltr" inputMode="numeric" value={phone} onChange={e=>setPhone(e.target.value.replace(/\D/g,'').slice(0,11))} placeholder="09123456789" autoFocus/><button className="primary" type="submit">ثبت و ادامه</button></form><small>در نسخه دمو پیامک واقعی ارسال نمی‌شود.</small></div></div>
}

function App(){
  const [cars,setCars]=useState(fallbackCars),[status,setStatus]=useState('demo'),[notice,setNotice]=useState(''),[loading,setLoading]=useState(true),[toast,setToast]=useState(''),[total,setTotal]=useState(fallbackCars.length),[filters,setFilters]=useState({}),[modal,setModal]=useState(null)
  function showToast(message){setToast(message);window.clearTimeout(showToast.timer);showToast.timer=window.setTimeout(()=>setToast(''),3200)}
  async function loadListings(nextFilters=filters,limit=6){
    setLoading(true)
    const params=new URLSearchParams({limit:String(limit)})
    if(nextFilters.brand&&!nextFilters.brand.startsWith('همه')) params.set('brand',nextFilters.brand)
    if(nextFilters.budget&&!nextFilters.budget.startsWith('همه')) params.set('budget',nextFilters.budget)
    if(nextFilters.year&&!nextFilters.year.startsWith('همه')) params.set('year',nextFilters.year)
    try{
      const response=await fetch(`/api/listings?${params}`), data=await response.json()
      setCars(data.items||[]);setTotal(data.totalMatches??data.items?.length??0);setStatus(data.source||'demo');setNotice(data.notice||'')
    }catch{setStatus('demo');setNotice('دریافت اطلاعات ممکن نشد؛ داده نمونه نمایش داده می‌شود.')}
    finally{setLoading(false)}
  }
  useEffect(()=>{loadListings({},6)},[])
  function search(nextFilters){setFilters(nextFilters);loadListings(nextFilters,6);showToast('فیلترها اعمال شدند؛ بهترین فرصت‌ها مرتب شدند.');document.querySelector('#opportunities')?.scrollIntoView({behavior:'smooth'})}
  function loadMore(){loadListings(filters,Math.min(200,cars.length+12))}
  return <><Header onLogin={()=>setModal('login')}/><Hero/><SearchPanel onSearch={search}/><Opportunities cars={cars} status={status} notice={notice} loading={loading} total={total} onLoadMore={loadMore} onToast={showToast}/><Method/><Score/><FAQ/><Footer onNotify={()=>setModal('notify')}/>{modal&&<ActionModal type={modal} onClose={()=>setModal(null)} onDone={showToast}/>} {toast&&<div className="toast"><Check/>{toast}</div>}</>
}

createRoot(document.getElementById('root')).render(<App/>)
