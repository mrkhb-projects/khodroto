import React,{useEffect,useMemo,useState}from'react'
import{Download,ShieldAlert,Activity,AlertTriangle,BarChart3,Bell,Bot,Car,ChevronLeft,CircleHelp,ClipboardList,CreditCard,Database,Eye,FileClock,FileText,Globe2,HardDrive,Image,KeyRound,LayoutDashboard,LockKeyhole,MapPinned,Menu,MessageSquareText,Megaphone,Navigation,Palette,Plus,Radio,ReceiptText,RefreshCw,Save,Search,Settings,ShieldCheck,Tags,TicketCheck,Trash2,TrendingUp,Users,WalletCards,Wrench,X}from'lucide-react'
import{IntegrationsManager}from'./admin-integrations'

const n=value=>new Intl.NumberFormat('fa-IR').format(value||0)
const money=value=>`${n(Math.round((value||0)/1e6))} م.ت`
const date=value=>value?new Date(value).toLocaleString('fa-IR'):'—'
const listingStatus={active:'فعال',stale:'در انتظار بررسی',inactive:'غیرفعال',removed:'حذف‌شده'}
const ticketStatus={open:'باز',pending:'در حال بررسی',closed:'بسته'}
const subscriptionStatus={active:'فعال',pending:'در انتظار',expired:'منقضی',cancelled:'لغوشده'}

export function AdminPage(){
 const[tab,setTab]=useState('overview'),[stats,setStats]=useState(null),[status,setStatus]=useState(null),[data,setData]=useState([]),[settings,setSettings]=useState({}),[integrations,setIntegrations]=useState({payment:[],sms:[]}),[slides,setSlides]=useState([]),[plans,setPlans]=useState([]),[error,setError]=useState(''),[busy,setBusy]=useState(false),[menu,setMenu]=useState(false),[authRequired,setAuthRequired]=useState(false),[notice,setNotice]=useState('')
 async function api(url,options){const response=await fetch(url,options);if(response.status===401||response.status===403){setAuthRequired(true);setError(response.status===401?'برای مشاهده پنل، ورود امن مدیر لازم است.':'این حساب دسترسی مدیریت ندارد.');throw Error('AUTH')}const body=await response.json();if(!response.ok){const requestError=Error(body.error||'REQUEST_FAILED');requestError.data=body;throw requestError}return body}
 async function load(next=tab){setBusy(true);setError('');try{const[summary,integration]=await Promise.all([api('/api/admin/stats'),fetch('/api/integration/status').then(r=>r.json())]);setStats(summary);setStatus(integration);if(next==='users')setData((await api('/api/admin/users')).items);if(next==='plans')setPlans((await api('/api/admin/plans')).items);if(next==='subscriptions')setData((await api('/api/admin/subscriptions')).items);if(next==='tickets')setData((await api('/api/admin/tickets')).items);if(next==='listings')setData((await api('/api/admin/listings')).items);if(next==='content'){const result=await api('/api/admin/slides');setSlides(result.items)}if(['audit','reports'].includes(next))setData((await api('/api/admin/audits')).items);if(next==='finance')setData((await api('/api/admin/subscriptions')).items);if(['settings','taxonomy','pages','faq','navigation','notifications','seo','appearance','crawler','security','backup','promotions'].includes(next)){const general=await api('/api/admin/settings');setSettings(general.settings)}if(next==='settings'){const[payment,sms]=await Promise.all([api('/api/admin/integrations/payment'),api('/api/admin/integrations/sms')]);setIntegrations({payment:payment.items,sms:sms.items})}}catch(error){if(error.message!=='AUTH')setError('دریافت اطلاعات مدیریت انجام نشد.')}finally{setBusy(false)}}
 useEffect(()=>{load(tab)},[tab])
 async function patch(url,body){setNotice('');await api(url,{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify(body)});await load(tab);setNotice('تغییرات با موفقیت ذخیره و در سامانه ثبت شد.')}
 async function syncCatalog(){setBusy(true);setError('');setNotice('');try{const result=await api('/api/admin/catalog/sync',{method:'POST'});setNotice(`ساختار دیوار همگام شد: ${n(result.cities)} شهر، ${n(result.categories.length)} دسته و ${n(result.brands.length)} برند.`);await load('taxonomy')}catch(error){setError('همگام‌سازی زنده دسته‌ها از دیوار انجام نشد؛ اتصال ایران یا رله خصوصی را بررسی کنید.')}finally{setBusy(false)}}
 async function refreshCrawler(){setBusy(true);setError('');setNotice('');try{const result=await api('/api/admin/crawler/refresh',{method:'POST'});await load('overview');setNotice(`${n(result.total)} آگهی واقعی از ${n(result.pages)} صفحه، ${n(result.cities)} شهر، ${n(result.categories)} دسته و ${n(result.scopes)} محدوده دریافت و پردازش شد.`)}catch(requestError){const code=requestError.message;setError(requestError.data?.message||(code==='UPSTREAM_ERROR'?'سرور فعلی به دیوار دسترسی شبکه ندارد. روی Render باید رله خصوصی ایران را در DIVAR_API_BASE_URL تنظیم کنید.':code==='RATE_LIMITED'?'دیوار موقتاً تعداد درخواست‌ها را محدود کرده است؛ چند دقیقه بعد دوباره تلاش کنید.':'جمع‌آوری انجام نشد. تنظیمات اتصال دیوار را بررسی کنید.'))}finally{setBusy(false)}}
 function choose(id){setTab(id);setMenu(false)}
 const menuGroups=[
  ['نمای کلی',[['overview','داشبورد مدیریت',LayoutDashboard],['reports','آمار و گزارش‌ها',BarChart3]]],
  ['بازار خودرو',[['listings','مدیریت آگهی‌ها',Car],['taxonomy','برند، دسته و شهر',Tags],['crawler','جمع‌آوری و تحلیل',Bot],['health','سلامت داده و عملیات',Activity],['sellers','سابقهٔ فروشندگان',ShieldAlert]]],
  ['کاربران',[['users','کاربران و مدیران',Users],['security','نقش‌ها و امنیت',LockKeyhole],['tickets','تیکت‌های پشتیبانی',TicketCheck],['notifications','اعلان‌ها و پیامک',Bell]]],
  ['مالی و اشتراک',[['subscriptions','اشتراک کاربران',WalletCards],['plans','پلن‌های اشتراک',CreditCard],['finance','تراکنش‌ها و درآمد',ReceiptText],['promotions','کمپین و تخفیف',Megaphone]]],
  ['محتوا و ظاهر',[['content','اسلایدر و بنر',Image],['pages','صفحات و قوانین',FileText],['faq','سوالات متداول',CircleHelp],['navigation','منو و فوتر',Navigation],['appearance','ظاهر و نمایش',Palette],['seo','سئو و شبکه اجتماعی',Globe2]]],
  ['سیستم',[['settings','تنظیمات و اتصال‌ها',Settings],['backup','پشتیبان‌گیری و نگهداری',HardDrive],['audit','گزارش فعالیت مدیران',FileClock]]]
 ]
 const tabs=menuGroups.flatMap(group=>group[1]),current=tabs.find(item=>item[0]===tab)
 if(authRequired)return <AdminLogin onSuccess={()=>{setAuthRequired(false);setError('');load(tab)}}/>
 return <main className="admin-shell"><aside className={'admin-sidebar '+(menu?'open':'')}><div className="admin-sidebar-brand"><img src="/brand/khodroto-mark.svg"/><div><b>خودروتو</b><span>مرکز مدیریت</span></div><button onClick={()=>setMenu(false)}><X/></button></div><nav>{menuGroups.map(([group,items])=><div className="admin-nav-group" key={group}><span>{group}</span>{items.map(([id,label,Icon])=><button className={tab===id?'active':''} onClick={()=>choose(id)} key={id}><Icon/>{label}{id==='tickets'&&stats?.tickets>0&&<i>{n(stats.tickets)}</i>}</button>)}</div>)}</nav><div className="admin-sidebar-foot"><span className={status?.connected?'online':'offline'}><i/>{status?.connected?'سامانه متصل':'داده واقعی قطع است'}</span><a href="/">مشاهده وب‌سایت <ChevronLeft/></a></div></aside><section className="admin-workspace"><header className="admin-topbar"><button className="admin-menu" onClick={()=>setMenu(true)}><Menu/></button><div><span>پنل مدیریت فارسی خودروتو</span><h1>{current?.[1]}</h1></div><div className="admin-top-actions"><span>{new Date().toLocaleDateString('fa-IR',{weekday:'long',year:'numeric',month:'long',day:'numeric'})}</span><button onClick={()=>load(tab)}><RefreshCw className={busy?'spin':''}/> تازه‌سازی</button></div></header><div className="admin-canvas">{error&&<div className="admin-warning"><AlertTriangle/>{error}</div>}{notice&&<div className="admin-success"><ShieldCheck/>{notice}</div>}{tab==='overview'&&<Overview stats={stats} status={status} refresh={refreshCrawler} busy={busy} navigate={choose}/>} {tab==='users'&&<UsersPanel patch={patch}/>} {tab==='plans'&&<PlansPanel items={plans} setItems={setPlans} api={api}/>} {tab==='subscriptions'&&<SubscriptionsPanel items={data} patch={patch}/>} {tab==='tickets'&&<TicketsPanel items={data} patch={patch}/>} {tab==='listings'&&<ListingsPanel items={data} patch={patch}/>} {tab==='content'&&<ContentPanel items={slides} reload={()=>load('content')} api={api}/>} {tab==='taxonomy'&&<CatalogPanel config={configPanels.taxonomy} value={settings} setValue={setSettings} save={()=>patch('/api/admin/settings',settings)} sync={syncCatalog} busy={busy}/>} {tab==='pages'&&<ConfigPanel config={configPanels.pages} value={settings} setValue={setSettings} save={()=>patch('/api/admin/settings',settings)}/>} {tab==='faq'&&<ConfigPanel config={configPanels.faq} value={settings} setValue={setSettings} save={()=>patch('/api/admin/settings',settings)}/>} {tab==='navigation'&&<ConfigPanel config={configPanels.navigation} value={settings} setValue={setSettings} save={()=>patch('/api/admin/settings',settings)}/>} {tab==='notifications'&&<ConfigPanel config={configPanels.notifications} value={settings} setValue={setSettings} save={()=>patch('/api/admin/settings',settings)}/>} {tab==='seo'&&<ConfigPanel config={configPanels.seo} value={settings} setValue={setSettings} save={()=>patch('/api/admin/settings',settings)}/>} {tab==='appearance'&&<><ConfigPanel config={configPanels.appearance} value={settings} setValue={setSettings} save={()=>patch('/api/admin/settings',settings)}/><SettingsForm value={settings} setValue={setSettings} save={()=>patch('/api/admin/settings',settings)}/></>} {tab==='health'&&<HealthPanel/>}
   {tab==='sellers'&&<SellersPanel/>}
   {tab==='crawler'&&<CrawlerPanel status={status} settings={settings} setSettings={setSettings} save={()=>patch('/api/admin/settings',settings)} refresh={refreshCrawler} busy={busy}/>} {tab==='security'&&<ConfigPanel config={configPanels.security} value={settings} setValue={setSettings} save={()=>patch('/api/admin/settings',settings)}/>} {tab==='backup'&&<ConfigPanel config={configPanels.backup} value={settings} setValue={setSettings} save={()=>patch('/api/admin/settings',settings)}/>} {tab==='promotions'&&<ConfigPanel config={configPanels.promotions} value={settings} setValue={setSettings} save={()=>patch('/api/admin/settings',settings)}/>} {tab==='finance'&&<FinancePanel items={data} patch={patch}/>} {tab==='reports'&&<ReportsPanel stats={stats} items={data}/>} {tab==='settings'&&<><SettingsForm value={settings} setValue={setSettings} save={()=>patch('/api/admin/settings',settings)}/><IntegrationsManager value={integrations} reload={()=>load('settings')}/></>} {tab==='audit'&&<AuditPanel items={data}/>}</div></section></main>
}

// Operations view. Every number here was already computed inside the server and
// none of it was reachable from the panel: the operator could not tell whether the
// crawl was running, how many listings were being hidden, whether the price
// sources were alive, or how far mileage enrichment had got.
function HealthPanel(){
 const [data,setData]=useState(null)
 const [busy,setBusy]=useState('')
 const [note,setNote]=useState('')
 const load=()=>fetch('/api/admin/health').then(response=>response.ok?response.json():null).then(setData).catch(()=>setData(null))
 useEffect(()=>{load()},[])

 async function run(label,url){
  setBusy(label);setNote('')
  try{
   const response=await fetch(url,{method:'POST'})
   const body=await response.json().catch(()=>({}))
   setNote(response.ok?`${label}: انجام شد${body.total?` (${n(body.total)} آگهی)`:body.rows?` (${n(body.rows)} قیمت)`:''}`:`${label}: ناموفق`)
   load()
  }catch{setNote(`${label}: ناموفق`)}finally{setBusy('')}
 }

 const actions=[
  ['جمع‌آوری تازه','/api/admin/crawler/refresh'],
  ['بازسازی میانگین بازار','/api/admin/market/rebuild'],
  ['به‌روزرسانی قیمت‌های مرجع','/api/admin/market/reference/refresh'],
  ['ارسال هشدارهای در صف','/api/admin/alerts/run'],
 ]

 return <>
  <header className="admin-section-hero"><span><Activity/></span><div><h2>سلامت داده و عملیات</h2><p>وضعیت واقعی خط لولهٔ داده و دکمه‌های اجرای دستی.</p></div><button className="primary" onClick={load}><RefreshCw/> تازه‌سازی</button></header>
  {note&&<div className="admin-panel" style={{padding:'12px 16px'}}>{note}</div>}
  <section className="admin-panel">
   <div className="admin-panel-title"><div><h2>خروجی داده</h2><p>برای تحلیل بیرون از پنل. فایل با BOM ذخیره می‌شود تا اکسل فارسی را درست باز کند.</p></div></div>
   <div className="admin-actions-row">
    <a className="secondary" href="/api/admin/export/users"><Download/> کاربران</a>
    <a className="secondary" href="/api/admin/export/subscriptions"><Download/> اشتراک‌ها</a>
    <a className="secondary" href="/api/admin/export/listings"><Download/> آگهی‌ها</a>
   </div>
  </section>
  <section className="admin-panel">
   <div className="admin-panel-title"><div><h2>اجرای دستی</h2><p>برای وقتی که نمی‌خواهید منتظر چرخهٔ خودکار بمانید.</p></div></div>
   <div className="admin-actions-row">{actions.map(([label,url])=>
    <button key={url} className="secondary" disabled={Boolean(busy)} onClick={()=>run(label,url)}>{busy===label?'در حال اجرا…':label}</button>)}</div>
  </section>
  {!data?<section className="admin-panel"><p style={{padding:16}}>در حال بارگذاری…</p></section>:<>
   <section className="admin-panel">
    <div className="admin-panel-title"><div><h2>بازار به تفکیک دسته</h2><p>چند آگهی تحلیل شده و چند تا از فید عمومی کنار گذاشته شده‌اند.</p></div></div>
    <table className="admin-table"><thead><tr><th>دسته</th><th>آگهی</th><th>پنهان</th><th>شرکتی</th><th>تکراری حذف‌شده</th><th>طلایی</th><th>مشکوک</th></tr></thead>
     <tbody>{data.market.map(row=><tr key={row.category}>
      <td>{row.category}</td>
      <td>{row.error?'—':n(row.listings)}</td><td>{row.error?'—':n(row.hidden)}</td><td>{row.error?'—':n(row.dealers)}</td>
      <td>{row.error?'—':n(row.duplicates)}</td><td>{row.error?'—':n(row.tiers?.golden||0)}</td><td>{row.error?row.error:n(row.tiers?.suspicious||0)}</td>
     </tr>)}</tbody></table>
   </section>
   <section className="admin-panel">
    <div className="admin-panel-title"><div><h2>سیاست فعلی نمایش</h2><p>از تنظیمات خوانده می‌شود؛ در «تنظیمات و اتصال‌ها» قابل تغییر است.</p></div></div>
    <div className="admin-actions-row">
     <span className="admin-pill">باند فرصت: {n(data.policy?.min)}٪ تا {n(data.policy?.max)}٪ زیر بازار</span>
     <span className="admin-pill">آگهی شرکتی زیر قیمت: {data.policy?.hideDealers?'پنهان':'نمایش'}</span>
     <span className="admin-pill">تکمیل مشخصات: {n(data.enrichment?.with_km||0)} کارکرد / {n(data.enrichment?.total||0)} آگهی</span>
    </div>
   </section>
   <SourceToggles sources={data.sources?.listings||[]} onSaved={load}/>
   <ManualReferencePanel/>
   <section className="admin-panel">
    <div className="admin-panel-title"><div><h2>منابع قیمت مرجع</h2><p>{n(data.reference?.models||0)} مدل قیمت مرجع در حافظه.</p></div></div>
    <table className="admin-table"><thead><tr><th>منبع</th><th>وضعیت</th><th>ردیف</th><th>توضیح</th></tr></thead>
     <tbody>{(data.sources?.reference||[]).map(row=><tr key={row.key}>
      <td>{row.name||row.key}</td><td>{row.ok?'سالم':'ناموفق'}</td><td>{n(row.rows||0)}</td><td>{row.note||'—'}</td>
     </tr>)}</tbody></table>
   </section>
  </>}
 </>
}

// Turning a source on used to mean editing .env over SSH and restarting the app.
function SourceToggles({sources,onSaved}){
 const [settings,setSettings]=useState(null)
 const [busy,setBusy]=useState(false)
 useEffect(()=>{fetch('/api/admin/settings').then(r=>r.ok?r.json():null).then(d=>setSettings(d?.settings||null))},[])
 const keyFor={bama:'source_bama',sheypoor:'source_sheypoor',ring:'source_ring',khodro45:'source_khodro45',hamrahmechanic:'source_hamrahmechanic'}
 async function toggle(sourceKey,next){
  const settingKey=keyFor[sourceKey]
  if(!settingKey)return
  setBusy(true)
  try{
   await fetch('/api/admin/settings',{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({[settingKey]:String(next)})})
   setSettings(prev=>({...prev,[settingKey]:String(next)}))
   onSaved?.()
  }finally{setBusy(false)}
 }
 return <section className="admin-panel">
  <div className="admin-panel-title"><div><h2>منابع آگهی</h2><p>روشن‌کردن منبع، آن را وارد چرخهٔ بعدی جمع‌آوری می‌کند. پیش از روشن‌کردن، روی هاست <code>node scripts/check-sources.mjs</code> را اجرا کنید.</p></div></div>
  <table className="admin-table"><thead><tr><th>منبع</th><th>دسته‌ها</th><th>وضعیت</th><th>آخرین نتیجه</th><th>توضیح</th></tr></thead>
   <tbody>{sources.map(row=>{
    const settingKey=keyFor[row.key]
    const on=settings?settings[settingKey]==='true':row.enabled
    return <tr key={row.key}>
     <td>{row.name}</td>
     <td>{(row.categories||[]).join('، ')}</td>
     <td><button className={on?'switch on':'switch'} disabled={busy||!settings} onClick={()=>toggle(row.key,!on)} aria-label="روشن یا خاموش کردن منبع"><i/></button></td>
     <td>{row.ok===null||row.ok===undefined?'اجرا نشده':row.ok?`${n(row.items)} آگهی`:'خطا'}</td>
     <td>{row.note||'—'}</td>
    </tr>})}</tbody></table>
 </section>
}

// When a price source starts parsing garbage there was no way to correct it short
// of editing the database by hand.
function ManualReferencePanel(){
 const [items,setItems]=useState(null)
 const [form,setForm]=useState({cohortKey:'',year:'',price:'',label:''})
 const [note,setNote]=useState('')
 const load=()=>fetch('/api/admin/reference/manual').then(r=>r.ok?r.json():null).then(d=>setItems(d?.items||[]))
 useEffect(()=>{load()},[])
 async function save(event){
  event.preventDefault();setNote('')
  const response=await fetch('/api/admin/reference/manual',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({...form,year:Number(form.year),price:Number(form.price)})})
  if(response.ok){setForm({cohortKey:'',year:'',price:'',label:''});setNote('ثبت شد و بلافاصله اعمال گردید.');load()}
  else setNote('ثبت نشد؛ شناسهٔ مدل، سال و قیمت را بررسی کنید.')
 }
 async function remove(row){
  await fetch(`/api/admin/reference/manual?cohortKey=${encodeURIComponent(row.cohortKey)}&year=${row.year}&trim=${encodeURIComponent(row.trim||'')}`,{method:'DELETE'})
  load()
 }
 return <section className="admin-panel">
  <div className="admin-panel-title"><div><h2>قیمت مرجع دستی</h2><p>قیمتی که اینجا وارد کنید بر خروجی همهٔ منابع خودکار اولویت دارد و با به‌روزرسانی آن‌ها پاک نمی‌شود.</p></div></div>
  {note&&<p style={{padding:'0 16px'}}>{note}</p>}
  <form className="admin-settings" onSubmit={save}>
   <label>شناسهٔ مدل (cohortKey)<input required placeholder="light|سواری|پژو|۲۰۷" value={form.cohortKey} onChange={e=>setForm({...form,cohortKey:e.target.value})}/></label>
   <label>سال<input required inputMode="numeric" placeholder="۱۴۰۱" value={form.year} onChange={e=>setForm({...form,year:e.target.value.replace(/\D/g,'')})}/></label>
   <label>قیمت (تومان)<input required inputMode="numeric" placeholder="950000000" value={form.price} onChange={e=>setForm({...form,price:e.target.value.replace(/\D/g,'')})}/></label>
   <label>برچسب<input placeholder="پژو ۲۰۷" value={form.label} onChange={e=>setForm({...form,label:e.target.value})}/></label>
   <button className="primary"><Save/> ثبت قیمت مرجع</button>
  </form>
  {items&&items.length>0&&<table className="admin-table"><thead><tr><th>مدل</th><th>سال</th><th>قیمت</th><th></th></tr></thead>
   <tbody>{items.map(row=><tr key={`${row.cohortKey}|${row.year}|${row.trim||''}`}>
    <td>{row.label||row.cohortKey}</td><td>{n(row.year)}</td><td>{money(row.price)}</td>
    <td><button className="secondary" onClick={()=>remove(row)}><Trash2/> حذف</button></td>
   </tr>)}</tbody></table>}
 </section>
}

// Sellers whose prices repeatedly fail the screen. The data was being aggregated
// into seller_reputation all along with nowhere to look at it.
function SellersPanel(){
 const [data,setData]=useState(null)
 useEffect(()=>{fetch('/api/admin/sellers').then(response=>response.ok?response.json():null).then(setData).catch(()=>setData(null))},[])
 const rows=data?.items||[]
 return <>
  <header className="admin-section-hero"><span><ShieldAlert/></span><div><h2>سابقهٔ فروشندگان</h2><p>فروشنده‌هایی که آگهی‌هایشان بیش از همه در غربالگری قیمت رد شده‌اند.</p></div></header>
  <section className="admin-panel">
   <div className="admin-panel-title"><div><h2>بدترین سوابق</h2><p>سابقه از {n(data?.minAds||5)} آگهی به بالا برای کاربران عمومی نمایش داده می‌شود.</p></div></div>
   {!data?<p style={{padding:16}}>در حال بارگذاری…</p>:rows.length===0
    ? <p style={{padding:16}}>هنوز سابقه‌ای ثبت نشده است. این جدول پس از آن پر می‌شود که خزنده هویت نمایشگاه‌ها را از صفحهٔ آگهی‌ها بخواند.</p>
    : <table className="admin-table"><thead><tr><th>فروشنده</th><th>آگهی</th><th>رد شده</th><th>نیازمند بررسی</th><th>نسبت رد</th><th>میانگین نسبت به مرجع</th></tr></thead>
       <tbody>{rows.map(row=><tr key={row.seller_key}>
        <td>{row.label||row.seller_key}</td><td>{n(row.listings)}</td><td>{n(row.rejected)}</td><td>{n(row.review)}</td>
        <td>{Math.round((row.rejected/Math.max(1,row.listings))*100)}٪</td>
        <td>{row.avg_reference_ratio?`${Math.round(row.avg_reference_ratio*100)}٪`:'—'}</td>
       </tr>)}</tbody></table>}
  </section>
 </>
}

function AdminLogin({onSuccess}){const[password,setPassword]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);async function submit(event){event.preventDefault();setBusy(true);setError('');try{const response=await fetch('/api/admin/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({password})}),body=await response.json();if(!response.ok)throw Error(body.error||'LOGIN_FAILED');onSuccess()}catch(error){setError(error.message==='ADMIN_LOGIN_NOT_CONFIGURED'?'رمز مدیریت در تنظیمات سرور تعریف نشده است.':error.message==='ADMIN_PHONE_NOT_CONFIGURED'?'شماره مدیر در تنظیمات سرور تعریف نشده است.':'رمز مدیریت صحیح نیست یا دفعات تلاش بیش از حد بوده است.')}finally{setBusy(false)}}return <main className="admin-login-page"><form onSubmit={submit} className="admin-login-card"><img src="/brand/khodroto-mark.svg" alt=""/><span>مسیر اختصاصی مدیریت</span><h1>ورود به مرکز فرمان خودروتو</h1><p>این صفحه از ورود کاربران سایت جداست. رمز امنی را که در متغیر <b>ADMIN_PASSWORD</b> سرور تعریف کرده‌اید وارد کنید.</p><label>رمز مدیریت<input type="password" autoComplete="current-password" value={password} onChange={e=>setPassword(e.target.value)} minLength="12" required autoFocus placeholder="حداقل ۱۲ کاراکتر"/></label>{error&&<div className="admin-login-error"><AlertTriangle/>{error}</div>}<button className="primary" disabled={busy}>{busy?'در حال بررسی…':'ورود امن به مدیریت'}</button><a href="/">بازگشت به وب‌سایت</a></form></main>}

function Overview({stats,status,refresh,busy,navigate}){const cards=[[Car,'کل آگهی‌ها',stats?.listings,'آرشیو بازار'],[Activity,'بررسی امروز',stats?.analyzedToday,'داده یکتای امروز'],[Users,'کاربران',stats?.users,'حساب ثبت‌شده'],[WalletCards,'اشتراک فعال',stats?.subscriptions,'کاربر حرفه‌ای'],[TicketCheck,'تیکت باز',stats?.tickets,'نیازمند پاسخ'],[CreditCard,'درگاه فعال',stats?.paymentGateways,'اتصال هم‌زمان'],[MessageSquareText,'پنل پیامکی',stats?.smsProviders,'مسیر ارسال'],[Image,'اسلاید فعال',stats?.activeSlides,'محتوای صفحه اصلی']];const listingTotal=Math.max(1,stats?.listings||1),segments=[['فعال',stats?.activeListings,'#2b9b79'],['در انتظار',stats?.staleListings,'#e4a839'],['غیرفعال',stats?.inactiveListings,'#e77948'],['حذف‌شده',stats?.removedListings,'#c74349']];return <><div className="admin-kpis">{cards.map(([Icon,label,value,hint])=><article key={label}><span><Icon/></span><div><small>{label}</small><b>{n(value)}</b><em>{hint}</em></div></article>)}</div><div className="admin-overview-grid"><section className="admin-panel market-health"><div className="admin-panel-title"><div><h2>سلامت بازار و آگهی‌ها</h2><p>توزیع وضعیت رکوردهای ذخیره‌شده</p></div><button onClick={()=>navigate('listings')}>مدیریت آگهی‌ها</button></div><div className="market-bar">{segments.map(([label,value,color])=><i key={label} style={{width:`${Math.max(0,(value||0)/listingTotal*100)}%`,background:color}}/>)}</div><div className="market-legend">{segments.map(([label,value,color])=><span key={label}><i style={{background:color}}/><b>{n(value)}</b>{label}</span>)}</div><div className="golden-summary"><span>فرصت طلایی فعال</span><b>{n(stats?.goldenOpportunities)}</b><small>امتیاز ۸۵ به بالا</small></div></section><section className="admin-panel collector-health"><div className="admin-panel-title"><div><h2>جمع‌آوری داده</h2><p>وضعیت اتصال مستقیم و کش</p></div></div><div className="collector-ring"><div className={status?.connected?'ok':'warn'}><Database/><b>{status?.connected?'متصل':'قطع'}</b><small>{status?.provider||'—'}</small></div></div><ul><li><span>زمان کش</span><b>{n(status?.cacheTtlMinutes)} دقیقه</b></li><li><span>جست‌وجوی کش‌شده</span><b>{n(status?.cachedSearches)}</b></li><li><span>Worker</span><b>{status?.refreshing?'در حال اجرا':'آماده'}</b></li><li><span>مسیر اتصال</span><b>{status?.viaRelay?'رله ایران':status?.official?'کنار رسمی':'مستقیم'}</b></li>{status?.lastError&&<li className="collector-error"><span>آخرین خطا</span><b>{status.lastError.code}</b></li>}</ul><button className="primary admin-crawl" onClick={refresh} disabled={busy}><RefreshCw className={busy?'spin':''}/> {busy?'در حال اتصال و دریافت داده…':'جمع‌آوری داده واقعی همین حالا'}</button></section></div><section className="admin-panel quick-admin"><div className="admin-panel-title"><div><h2>عملیات سریع مدیر</h2><p>دسترسی به کارهای پرتکرار</p></div></div><div>{[[Users,'مدیریت نقش کاربران','users'],[TicketCheck,'پاسخ به تیکت‌ها','tickets'],[Image,'ویرایش اسلایدرها','content'],[Settings,'تنظیم درگاه و پیامک','settings']].map(([Icon,label,id])=><button key={id} onClick={()=>navigate(id)}><Icon/><span>{label}</span><ChevronLeft/></button>)}</div></section></>}

function PanelTools({query,setQuery,children}){return <div className="admin-list-tools"><label><Search/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="جست‌وجو در این بخش..."/></label>{children}</div>}
function Table({headers,rows,empty='هنوز داده‌ای ثبت نشده است.'}){return <section className="admin-table-wrap"><table className="admin-table"><thead><tr>{headers.map(header=><th key={header}>{header}</th>)}</tr></thead><tbody>{rows.length?rows.map((row,index)=><tr key={index}>{row.map((cell,cellIndex)=><td key={cellIndex}>{cell}</td>)}</tr>):<tr><td colSpan={headers.length}>{empty}</td></tr>}</tbody></table></section>}
function UsersPanel({patch}){
 // Was: fetch everything, filter in the browser. With a few thousand users that
 // ships the whole table on every tab switch and silently truncates at the SQL
 // LIMIT, so an admin searching for someone who sits past it finds nothing.
 const [query,setQuery]=useState('')
 const [role,setRole]=useState('')
 const [page,setPage]=useState(0)
 const [result,setResult]=useState({items:[],total:0})
 const [loading,setLoading]=useState(false)
 const pageSize=50
 useEffect(()=>{
  let alive=true
  setLoading(true)
  const params=new URLSearchParams({limit:String(pageSize),offset:String(page*pageSize)})
  if(query.trim())params.set('query',query.trim())
  if(role)params.set('role',role)
  const timer=setTimeout(()=>{
   fetch(`/api/admin/users?${params}`).then(r=>r.ok?r.json():{items:[],total:0})
    .then(data=>{if(alive)setResult(data)}).finally(()=>{if(alive)setLoading(false)})
  },250) // debounce so typing does not fire a query per keystroke
  return()=>{alive=false;clearTimeout(timer)}
 },[query,role,page])
 useEffect(()=>{setPage(0)},[query,role])
 const pages=Math.max(1,Math.ceil(result.total/pageSize))
 return <>
  <PanelTools query={query} setQuery={setQuery}>
   <span>{n(result.total)} کاربر</span>
   <select value={role} onChange={event=>setRole(event.target.value)}>
    <option value="">همهٔ نقش‌ها</option><option value="user">کاربر</option><option value="admin">مدیر</option>
   </select>
   <a className="secondary" href="/api/admin/export/users"><Download/> خروجی CSV</a>
  </PanelTools>
  <Table headers={['کاربر','موبایل','شهر','پلن','نقش','عضویت','عملیات']} rows={result.items.map(item=>[
   item.name,item.phone,item.city,item.plan||'رایگان',item.role==='admin'?'مدیر':'کاربر',item.created_at?.slice(0,10)||'—',
   <button className="secondary" key={item.id} onClick={()=>patch(`/api/admin/users/${item.id}`,{role:item.role==='admin'?'user':'admin'})}>{item.role==='admin'?'سلب دسترسی مدیر':'ارتقا به مدیر'}</button>,
  ])}/>
  {loading&&<p style={{padding:'0 16px'}}>در حال جست‌وجو…</p>}
  {pages>1&&<div className="admin-actions-row">
   <button className="secondary" disabled={page===0} onClick={()=>setPage(value=>value-1)}>صفحهٔ قبل</button>
   <span className="admin-pill">صفحهٔ {n(page+1)} از {n(pages)}</span>
   <button className="secondary" disabled={page>=pages-1} onClick={()=>setPage(value=>value+1)}>صفحهٔ بعد</button>
  </div>}
 </>
}

function SubscriptionsPanel({items,patch}){const[q,setQ]=useState('');const filtered=items.filter(item=>`${item.name} ${item.phone} ${item.plan}`.includes(q));return <><PanelTools query={q} setQuery={setQ}><span>{n(filtered.length)} اشتراک</span></PanelTools><Table headers={['کاربر','پلن','مبلغ','وضعیت','شروع','انقضا','مدیریت']} rows={filtered.map(item=>[item.name||item.phone,item.plan,n(item.amount),<span className={'admin-badge '+item.status}>{subscriptionStatus[item.status]||item.status}</span>,date(item.started_at),date(item.expires_at),<select value={item.status} onChange={e=>patch(`/api/admin/subscriptions/${item.id}`,{status:e.target.value})}><option value="active">فعال</option><option value="pending">در انتظار</option><option value="expired">منقضی</option><option value="cancelled">لغوشده</option></select>])}/></>}
function TicketsPanel({items,patch}){const[q,setQ]=useState(''),[filter,setFilter]=useState('all');const filtered=items.filter(item=>(filter==='all'||item.status===filter)&&`${item.name} ${item.phone} ${item.subject} ${item.message}`.includes(q));return <><PanelTools query={q} setQuery={setQ}><select value={filter} onChange={e=>setFilter(e.target.value)}><option value="all">همه وضعیت‌ها</option><option value="open">باز</option><option value="pending">در حال بررسی</option><option value="closed">بسته</option></select></PanelTools><Table headers={['کاربر','موضوع','پیام','وضعیت','تاریخ','عملیات']} rows={filtered.map(item=>[item.name||item.phone||'مهمان',item.subject,<span className="ticket-message">{item.message}</span>,<span className={'admin-badge '+item.status}>{ticketStatus[item.status]}</span>,date(item.created_at),<select value={item.status} onChange={e=>patch(`/api/admin/tickets/${item.id}`,{status:e.target.value})}><option value="open">باز</option><option value="pending">در حال بررسی</option><option value="closed">بسته</option></select>])}/></>}
function ListingsPanel({items,patch}){const[q,setQ]=useState(''),[filter,setFilter]=useState('all');const filtered=items.filter(item=>(filter==='all'||item.status===filter)&&`${item.title} ${item.city} ${item.token}`.includes(q));return <><PanelTools query={q} setQuery={setQ}><select value={filter} onChange={e=>setFilter(e.target.value)}><option value="all">همه وضعیت‌ها</option>{Object.entries(listingStatus).map(([id,label])=><option key={id} value={id}>{label}</option>)}</select><span>{n(filtered.length)} رکورد</span></PanelTools><Table headers={['عنوان','شهر','قیمت','امتیاز','وضعیت','عدم مشاهده','آخرین مشاهده','عملیات']} rows={filtered.map(item=>[<div className="listing-admin-title"><b>{item.title}</b><small>{item.category}</small></div>,item.city,money(item.price),n(item.score),<span className={`listing-status ${item.status}`}>{listingStatus[item.status]||item.status}</span>,n(item.missing_count),date(item.last_seen_at),<div className="table-actions"><select value={item.status} onChange={e=>patch(`/api/admin/listings/${item.token}`,{status:e.target.value})}>{Object.entries(listingStatus).map(([id,label])=><option key={id} value={id}>{label}</option>)}</select><a target="_blank" rel="noreferrer" href={`https://divar.ir/v/${item.token}`}><Eye/> دیوار</a></div>])}/></>}

const blankSlide={title:'',subtitle:'',badge:'',cta_text:'مشاهده',cta_link:'/cars',image:'/banners/market-analysis.jpg',theme:'navy',enabled:true,sort_order:100}
function ContentPanel({items,reload,api}){const[editing,setEditing]=useState(null),[draft,setDraft]=useState(blankSlide),[busy,setBusy]=useState(false);function edit(item){setEditing(item.id);setDraft({...item})}function add(){setEditing('new');setDraft({...blankSlide})}async function save(event){event.preventDefault();setBusy(true);try{await api(editing==='new'?'/api/admin/slides':`/api/admin/slides/${editing}`,{method:editing==='new'?'POST':'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify(draft)});setEditing(null);reload()}finally{setBusy(false)}}async function remove(id){if(!window.confirm('این اسلاید حذف شود؟'))return;await api(`/api/admin/slides/${id}`,{method:'DELETE'});reload()}return <><div className="content-admin-head"><div><h2>اسلایدر و بنرهای صفحه اصلی</h2><p>متن، تصویر، دکمه، ترتیب و وضعیت انتشار را مدیریت کنید.</p></div><button className="primary" onClick={add}><Plus/> اسلاید جدید</button></div>{editing&&<form className="slide-editor" onSubmit={save}><div className="slide-preview" style={{backgroundImage:`linear-gradient(90deg,rgba(9,24,44,.1),rgba(9,24,44,.9)),url(${draft.image})`}}><span>{draft.badge}</span><h3>{draft.title||'عنوان اسلاید'}</h3><p>{draft.subtitle||'توضیح کوتاه اسلاید'}</p></div><div className="slide-fields"><label>عنوان<input required value={draft.title} onChange={e=>setDraft({...draft,title:e.target.value})}/></label><label>برچسب<input value={draft.badge} onChange={e=>setDraft({...draft,badge:e.target.value})}/></label><label className="wide">توضیح<textarea value={draft.subtitle} onChange={e=>setDraft({...draft,subtitle:e.target.value})}/></label><label>متن دکمه<input value={draft.cta_text} onChange={e=>setDraft({...draft,cta_text:e.target.value})}/></label><label>لینک دکمه<input dir="ltr" value={draft.cta_link} onChange={e=>setDraft({...draft,cta_link:e.target.value})}/></label><label className="wide">آدرس تصویر<input dir="ltr" value={draft.image} onChange={e=>setDraft({...draft,image:e.target.value})}/></label><label>تم<select value={draft.theme} onChange={e=>setDraft({...draft,theme:e.target.value})}><option value="navy">سرمه‌ای</option><option value="gold">طلایی</option><option value="teal">سبز</option><option value="coral">مرجانی</option></select></label><label>ترتیب<input type="number" value={draft.sort_order} onChange={e=>setDraft({...draft,sort_order:e.target.value})}/></label></div><label className="integration-enabled"><input type="checkbox" checked={draft.enabled} onChange={e=>setDraft({...draft,enabled:e.target.checked})}/> منتشر شود</label><div className="integration-actions"><button className="primary" disabled={busy}><Save/> ذخیره</button><button type="button" className="secondary" onClick={()=>setEditing(null)}>انصراف</button></div></form>}<div className="slides-admin-grid">{items.map(item=><article className={!item.enabled?'disabled':''} key={item.id}><div className="slide-thumb" style={{backgroundImage:`linear-gradient(0deg,rgba(9,24,44,.8),transparent),url(${item.image})`}}><span>{item.badge}</span><b>{item.title}</b></div><div><span className={'admin-badge '+(item.enabled?'active':'inactive')}>{item.enabled?'منتشرشده':'پیش‌نویس'}</span><small>ترتیب {n(item.sort_order)}</small></div><footer><button onClick={()=>edit(item)}>ویرایش</button><button className="danger" onClick={()=>remove(item.id)}><Trash2/> حذف</button></footer></article>)}</div></>}
function AuditPanel({items}){const[q,setQ]=useState('');const filtered=items.filter(item=>`${item.action} ${item.entity} ${item.admin_name} ${item.details}`.includes(q));return <><PanelTools query={q} setQuery={setQ}><span>{n(filtered.length)} رویداد اخیر</span></PanelTools><Table headers={['زمان','مدیر','عملیات','بخش','شناسه','جزئیات']} rows={filtered.map(item=>[date(item.created_at),item.admin_name||item.admin_phone||'سیستم',item.action,item.entity,item.entity_id||'—',item.details||'—'])}/></>}
const configPanels={
 taxonomy:{icon:Tags,title:'ساختار بازار خودرو',description:'برندها، دسته‌بندی‌ها، شهرها و گزینه‌های فیلتر عمومی را از یک نقطه کنترل کنید.',sections:[['دسته‌بندی و محدوده بازار',[['vehicle_categories','دسته‌های فعال خودرو','textarea','هر خط: شناسه | عنوان'],['vehicle_brands','برندهای قابل انتخاب','textarea','هر برند در یک خط'],['vehicle_models','مدل‌های هر برند','textarea','هر خط: برند | مدل ۱, مدل ۲'],['supported_cities','شهرهای فعال','textarea','هر خط: کد | نام شهر'],['vehicle_colors','رنگ‌های قابل انتخاب','textarea','هر رنگ در یک خط']]],['رفتار فیلترها',[['default_city','شهر پیش‌فرض','text'],['default_sort','مرتب‌سازی پیش‌فرض','select',['score','newest','cheap','expensive']],['exclude_no_photo','حذف آگهی بدون تصویر','toggle'],['enable_motorcycles','فعال بودن موتورسیکلت','toggle'],['enable_heavy_vehicles','فعال بودن خودرو سنگین','toggle']]]]},
 pages:{icon:FileText,title:'مدیریت صفحات و اطلاعات حقوقی',description:'متن صفحات ثابت سایت را بدون تغییر کد ویرایش و منتشر کنید.',sections:[['صفحات سازمانی',[['about_content','متن درباره ما','textarea'],['contact_intro','متن صفحه تماس','textarea'],['methodology_content','توضیح روش تحلیل','textarea'],['data_sources_content','توضیح منابع داده','textarea']]],['حقوقی',[['terms_content','قوانین استفاده','textarea'],['privacy_content','حریم خصوصی','textarea'],['legal_notice','هشدار حقوقی معاملات','textarea']]]]},
 faq:{icon:CircleHelp,title:'سوالات متداول',description:'پرسش‌های عمومی، خرید اشتراک و تحلیل خودرو را مدیریت کنید.',sections:[['محتوای FAQ',[['faq_content','پرسش و پاسخ‌ها','textarea','هر خط: پرسش | پاسخ'],['faq_enabled','انتشار صفحه سوالات','toggle'],['faq_home_count','تعداد سوال در صفحه اصلی','number']]]]},
 navigation:{icon:Navigation,title:'منو، پیوندها و فوتر',description:'چیدمان منوی اصلی، لینک‌های فوتر و اطلاعات تماس را مدیریت کنید.',sections:[['ناوبری',[['header_links','منوی اصلی','textarea','هر خط: عنوان | مسیر'],['footer_platform_links','ستون خودروتو در فوتر','textarea'],['footer_help_links','ستون راهنما در فوتر','textarea']]],['فوتر و شبکه‌ها',[['footer_description','توضیح کوتاه فوتر','textarea'],['social_links','شبکه‌های اجتماعی','textarea','هر خط: نام | لینک'],['copyright_text','متن کپی‌رایت','text']]]]},
 notifications:{icon:Bell,title:'مرکز اعلان‌ها و پیام‌ها',description:'قواعد ارسال هشدار، پیامک و اعلان‌های سیستمی را کنترل کنید.',sections:[['قواعد ارسال',[['notification_master','ارسال اعلان فعال باشد','toggle'],['sms_otp_enabled','پیامک ورود فعال باشد','toggle'],['sms_alert_enabled','پیامک فرصت جدید فعال باشد','toggle'],['email_enabled','ایمیل‌های سیستمی فعال باشد','toggle'],['quiet_hours','ساعات سکوت ارسال','text']]],['الگوهای پیام',[['otp_template','متن رمز یکبار مصرف','textarea'],['opportunity_template','متن هشدار فرصت جدید','textarea'],['subscription_template','متن فعال‌سازی اشتراک','textarea']]]]},
 seo:{icon:Globe2,title:'سئو و اشتراک‌گذاری اجتماعی',description:'عنوان‌ها، متا، Open Graph و تنظیمات ایندکس سایت را مدیریت کنید.',sections:[['سئوی عمومی',[['seo_title','عنوان پیش‌فرض سایت','text'],['seo_description','توضیحات متا','textarea'],['seo_keywords','کلمات کلیدی','textarea'],['canonical_url','دامنه canonical','text'],['robots_index','اجازه ایندکس موتور جست‌وجو','toggle']]],['شبکه اجتماعی و داده ساختاریافته',[['og_title','عنوان Open Graph','text'],['og_description','توضیح Open Graph','textarea'],['og_image','تصویر اشتراک‌گذاری','text'],['organization_schema','اطلاعات سازمان برای Schema','textarea']]]]},
 appearance:{icon:Palette,title:'ظاهر، هویت و تجربه کاربری',description:'رنگ‌ها، تراکم نمایش و قابلیت‌های رابط عمومی را تنظیم کنید.',sections:[['هویت بصری',[['brand_primary','رنگ اصلی','text'],['brand_accent','رنگ مکمل','text'],['logo_url','آدرس لوگو','text'],['favicon_url','آدرس فاوآیکن','text']]],['تجربه کاربری',[['public_font_scale','مقیاس فونت عمومی','select',['normal','large','xlarge']],['show_announcement','نوار اعلان نمایش داده شود','toggle'],['enable_motion','انیمیشن‌ها فعال باشند','toggle'],['dark_mode_available','حالت تیره در دسترس باشد','toggle']]]]},
 security:{icon:LockKeyhole,title:'امنیت، دسترسی و نشست‌ها',description:'سیاست‌های ورود و سطح دسترسی مدیریت را تنظیم کنید؛ رمزها در متغیر امن سرور باقی می‌مانند.',sections:[['امنیت ورود',[['otp_expiry_minutes','اعتبار کد ورود (دقیقه)','number'],['max_login_attempts','حداکثر تلاش ورود','number'],['admin_session_hours','اعتبار نشست مدیر (ساعت)','number'],['force_secure_cookie','کوکی امن اجباری','toggle']]],['کنترل دسترسی',[['allow_admin_role_change','تغییر نقش توسط مدیر ارشد','toggle'],['audit_retention_days','نگهداری گزارش فعالیت (روز)','number'],['maintenance_allow_admin','دسترسی مدیر هنگام تعمیرات','toggle']]]]},
 backup:{icon:HardDrive,title:'پشتیبان‌گیری و نگهداری',description:'سیاست نگهداری داده و وضعیت سلامت سامانه را تعیین کنید.',sections:[['نسخه پشتیبان',[['backup_enabled','پشتیبان‌گیری دوره‌ای فعال','toggle'],['backup_schedule','زمان‌بندی پشتیبان','select',['daily','weekly','monthly']],['backup_retention','تعداد نسخه قابل نگهداری','number'],['backup_destination','مقصد پشتیبان','text']]],['نگهداری',[['log_retention_days','نگهداری لاگ‌ها (روز)','number'],['inactive_listing_days','بایگانی آگهی غیرفعال (روز)','number'],['healthcheck_enabled','پایش سلامت فعال','toggle']]]]},
 promotions:{icon:Megaphone,title:'کمپین‌ها، کد تخفیف و پیشنهادها',description:'پیشنهاد فروش اشتراک و پیام کمپین عمومی را مدیریت کنید.',sections:[['کمپین فعال',[['campaign_enabled','کمپین فعال باشد','toggle'],['campaign_title','عنوان کمپین','text'],['campaign_description','توضیح کمپین','textarea'],['campaign_discount','درصد تخفیف نمایشی','number'],['campaign_cta','متن دکمه کمپین','text']]],['کد تخفیف',[['discount_code','کد تخفیف فعال','text'],['discount_percent','درصد کد تخفیف','number'],['discount_expires','تاریخ پایان','text'],['discount_usage_limit','سقف استفاده','number']]]]},
}
function CatalogPanel({config,value,setValue,save,sync,busy}){const[catalog,setCatalog]=useState(null);useEffect(()=>{fetch('/api/catalog/vehicles').then(r=>r.json()).then(setCatalog).catch(()=>{})},[value.catalog_synced_at]);return <><section className="catalog-health"><div><b>{n(catalog?.cities?.length)}</b><span>شهر دیوار</span></div><div><b>{n(catalog?.categories?.length)}</b><span>دسته حوزه خودرو</span></div><div><b>{n(catalog?.brands?.length)}</b><span>برند فعال</span></div><div><b>{n(catalog?.models?.reduce((sum,item)=>sum+item.models.length,0))}</b><span>مدل خودرو</span></div><button className="primary" onClick={sync} disabled={busy}><RefreshCw className={busy?'spin':''}/> استخراج و همگام‌سازی از دیوار</button></section><ConfigPanel config={config} value={value} setValue={setValue} save={save}/></>}
function ConfigPanel({config,value,setValue,save}){const Icon=config.icon;return <div className="admin-config-page"><header className="admin-section-hero"><span><Icon/></span><div><h2>{config.title}</h2><p>{config.description}</p></div><button className="primary" onClick={save}><Save/> ذخیره تغییرات</button></header>{config.sections.map(([title,fields])=><section className="admin-panel config-section" key={title}><div className="admin-panel-title"><div><h2>{title}</h2><p>تمام تغییرات این بخش پس از ذخیره اعمال می‌شوند.</p></div></div><div className="config-fields">{fields.map(([key,label,type='text',extra])=><ConfigField key={key} fieldKey={key} label={label} type={type} extra={extra} value={value[key]??''} change={next=>setValue({...value,[key]:next})}/>)}</div></section>)}</div>}
function ConfigField({fieldKey,label,type,extra,value,change}){if(type==='toggle')return <label className="config-toggle"><span><b>{label}</b><small>{value==='false'?'غیرفعال':'فعال'}</small></span><button type="button" className={value!=='false'?'switch on':'switch'} onClick={()=>change(String(value==='false'))}><i/></button></label>;return <label className={'config-field '+(type==='textarea'?'wide':'')}><span>{label}</span>{type==='textarea'?<textarea rows="6" value={value} onChange={e=>change(e.target.value)} placeholder={extra}/>:type==='select'?<select value={value} onChange={e=>change(e.target.value)}>{extra.map(option=><option value={option} key={option}>{option}</option>)}</select>:<input type={type} value={value} onChange={e=>change(e.target.value)}/>} {extra&&type==='textarea'&&<small>{extra}</small>}</label>}
function CrawlerPanel({status,settings,setSettings,save,refresh,busy}){return <><header className="admin-section-hero"><span><Bot/></span><div><h2>جمع‌آوری، پردازش و تحلیل بازار</h2><p>منبع داده، دوره بروزرسانی، محدوده خزیدن و قواعد کیفیت را کنترل کنید.</p></div><button className="primary" onClick={refresh} disabled={busy}><RefreshCw className={busy?'spin':''}/> اجرای جمع‌آوری</button></header><section className="admin-panel crawler-control"><div className="crawler-status-cards"><article><Radio/><span><b>{status?.connected?'متصل':'قطع'}</b><small>وضعیت منبع داده</small></span></article><article><Database/><span><b>{n(status?.cachedSearches)}</b><small>جست‌وجوی کش‌شده</small></span></article><article><Activity/><span><b>{status?.refreshing?'در حال اجرا':'آماده'}</b><small>وضعیت Worker</small></span></article></div><div className="config-fields"><ConfigField label="دوره بروزرسانی (دقیقه)" type="number" value={settings.cache_minutes||'10'} change={v=>setSettings({...settings,cache_minutes:v})}/><ConfigField label="حداکثر صفحه هر محدوده" type="number" value={settings.crawler_max_pages||'0'} change={v=>setSettings({...settings,crawler_max_pages:v})}/><ConfigField label="شهرهای خزیدن" type="textarea" extra="کد شهر در هر خط" value={settings.crawler_cities||''} change={v=>setSettings({...settings,crawler_cities:v})}/><ConfigField label="عبارت‌های جست‌وجو" type="textarea" extra="هر عبارت در یک خط" value={settings.crawler_queries||''} change={v=>setSettings({...settings,crawler_queries:v})}/><ConfigField label="حذف آگهی بدون عکس" type="toggle" value={settings.exclude_no_photo||'true'} change={v=>setSettings({...settings,exclude_no_photo:v})}/><ConfigField label="فعال بودن تحلیل قیمت" type="toggle" value={settings.analysis_enabled||'true'} change={v=>setSettings({...settings,analysis_enabled:v})}/></div><button className="primary config-save-bottom" onClick={save}><Save/> ذخیره قواعد جمع‌آوری</button></section></>}
function FinancePanel({items,patch}){const active=items.filter(item=>item.status==='active'),income=items.reduce((sum,item)=>sum+(item.amount||0),0);return <><div className="report-kpis"><article><WalletCards/><span><small>کل تراکنش ثبت‌شده</small><b>{n(items.length)}</b></span></article><article><TrendingUp/><span><small>درآمد ثبت‌شده</small><b>{n(income)} تومان</b></span></article><article><CreditCard/><span><small>اشتراک فعال</small><b>{n(active.length)}</b></span></article></div><SubscriptionsPanel items={items} patch={patch}/></>}
function ReportsPanel({stats,items}){return <><header className="admin-section-hero"><span><BarChart3/></span><div><h2>مرکز گزارش‌های مدیریتی</h2><p>تصویر سریع از بازار، کاربران، درآمد، پشتیبانی و عملیات سیستم.</p></div></header><div className="report-kpis"><article><Car/><span><small>آگهی فعال</small><b>{n(stats?.activeListings)}</b></span></article><article><Users/><span><small>کاربر ثبت‌شده</small><b>{n(stats?.users)}</b></span></article><article><WalletCards/><span><small>اشتراک فعال</small><b>{n(stats?.subscriptions)}</b></span></article><article><TicketCheck/><span><small>تیکت باز</small><b>{n(stats?.tickets)}</b></span></article></div><section className="admin-panel report-summary"><h2>گزارش سلامت پلتفرم</h2><div><span>آگهی در انتظار بررسی <b>{n(stats?.staleListings)}</b></span><span>آگهی غیرفعال <b>{n(stats?.inactiveListings)}</b></span><span>فرصت طلایی <b>{n(stats?.goldenOpportunities)}</b></span><span>رویداد مدیریتی اخیر <b>{n(items.length)}</b></span></div></section></>}

function PlansPanel({items,setItems,api}){async function save(plan){const result=await api(`/api/admin/plans/${plan.id}`,{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({...plan,features:Array.isArray(plan.features)?plan.features:String(plan.features).split('\n').filter(Boolean)})});setItems(result.items)}function change(id,key,value){setItems(items.map(item=>item.id===id?{...item,[key]:value}:item))}return <section className="admin-panel settings-panel"><div className="admin-panel-title"><div><h2>پلن‌های اشتراک عمومی</h2><p>نام، قیمت، مزایا، اولویت و وضعیت فروش پلن‌ها را مدیریت کنید.</p></div></div><div className="admin-plans-editor">{items.map(plan=><article key={plan.id}><div className="plan-admin-head"><b>{plan.id}</b><label className="maintenance"><input type="checkbox" checked={plan.enabled} onChange={e=>change(plan.id,'enabled',e.target.checked)}/> فعال</label></div><label>نام پلن<input value={plan.name} onChange={e=>change(plan.id,'name',e.target.value)}/></label><label>قیمت ماهانه (تومان)<input type="number" value={plan.price} onChange={e=>change(plan.id,'price',e.target.value)}/></label><label>توضیح<input value={plan.description||''} onChange={e=>change(plan.id,'description',e.target.value)}/></label><label>مزایا؛ هر مورد در یک خط<textarea rows="6" value={(plan.features||[]).join('\n')} onChange={e=>change(plan.id,'features',e.target.value.split('\n'))}/></label><label className="maintenance"><input type="checkbox" checked={plan.popular} onChange={e=>change(plan.id,'popular',e.target.checked)}/> نشان پیشنهادی</label><button className="primary" onClick={()=>save(plan)}><Save/> ذخیره پلن</button></article>)}</div></section>}

function SettingsForm({value,setValue,save}){const fields=[['site_name','نام سایت'],['site_tagline','شعار سایت'],['hero_title','عنوان اصلی صفحه نخست'],['hero_description','توضیح اصلی صفحه نخست'],['support_phone','شماره پشتیبانی'],['support_email','ایمیل پشتیبانی'],['free_results','تعداد نتایج رایگان'],['cache_minutes','زمان کش (دقیقه)'],['score_golden_min','حداقل امتیاز فرصت طلایی'],['score_good_min','حداقل امتیاز فرصت خوب'],['opportunity_min_discount','شروع باند فرصت (٪ زیر بازار)'],['opportunity_max_discount','سقف باند فرصت (٪ زیر بازار)'],['seller_reputation_min_ads','حداقل آگهی برای نمایش سابقهٔ فروشنده']],cards=[['card_golden','فرصت‌های طلایی'],['card_good','فرصت‌های خوب'],['card_fair','قیمت‌های منصفانه'],['card_expensive','آگهی‌های گران'],['card_suspicious','آگهی‌های مشکوک']];return <section className="admin-panel settings-panel"><div className="admin-panel-title"><div><h2>تنظیمات عمومی پلتفرم</h2><p>هویت، نمایش کارت‌ها، اعلان متحرک و رفتار پایه سایت</p></div></div><div className="admin-settings">{fields.map(([key,label])=><label key={key}>{label}<input value={value[key]||''} onChange={e=>setValue({...value,[key]:e.target.value})}/></label>)}<div className="admin-settings-group"><h3>سبک کارت برای هر گروه آگهی</h3><p>شش طراحی متفاوت در سایت آماده است؛ برای هر سطح امتیاز یک مدل انتخاب کنید.</p><div className="card-style-previews">{[1,2,3,4,5,6].map(n=><span className={`card-style-${n}`} key={n}><i>مدل {n}</i><b>خودروی نمونه</b><small>امتیاز ۸۷</small></span>)}</div><div>{cards.map(([key,label])=><label key={key}>{label}<select value={value[key]||'1'} onChange={e=>setValue({...value,[key]:e.target.value})}>{[1,2,3,4,5,6].map(n=><option value={String(n)} key={n}>کارت مدل {n}</option>)}</select></label>)}</div><label>نمایش آگهی در موبایل<select value={value.mobile_listing_mode||'carousel'} onChange={e=>setValue({...value,mobile_listing_mode:e.target.value})}><option value="carousel">کاروسلی افقی</option><option value="stack">زیر هم</option></select></label></div><label className="admin-ticker-field">متن‌های متحرک بالای سایت<textarea value={value.hero_ticker||''} onChange={e=>setValue({...value,hero_ticker:e.target.value})} rows="5"/><small>هر خط: عنوان | توضیح | امتیاز</small></label><div className="admin-settings-group"><h3>فعال‌سازی بخش‌ها و قابلیت‌ها</h3><p>هر بخش عمومی را بدون تغییر کد روشن یا خاموش کنید.</p><div className="admin-feature-grid">{[['section_slider','اسلایدر بازار'],['section_search','جست‌وجوی صفحه نخست'],['section_opportunities','فرصت‌های امروز'],['section_campaign','بنر اشتراک'],['section_method','روش تحلیل'],['section_score','معرفی امتیاز'],['section_faq','پرسش‌های متداول'],['feature_comparison','مقایسه خودرو'],['feature_alerts','هشدار هوشمند'],['feature_pricing','فروش اشتراک']].map(([key,label])=><label className="maintenance" key={key}><input type="checkbox" checked={value[key]!=='false'} onChange={e=>setValue({...value,[key]:String(e.target.checked)})}/>{label}</label>)}</div></div><label className="maintenance"><input type="checkbox" checked={value.hide_dealer_ads!=='false'} onChange={e=>setValue({...value,hide_dealer_ads:String(e.target.checked)})}/> پنهان‌کردن آگهی‌های شرکتی که زیر قیمت بازارند</label><label className="maintenance"><input type="checkbox" checked={value.maintenance_mode==='true'} onChange={e=>setValue({...value,maintenance_mode:String(e.target.checked)})}/> حالت تعمیر و نگهداری</label><button className="primary" onClick={save}><Save/> ذخیره تنظیمات</button></div></section>}
