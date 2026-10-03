import { DatabaseSync } from 'node:sqlite'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

const now=()=>new Date().toISOString()
const tehranDate=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Tehran',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())
const json=value=>JSON.stringify(value??null)
export function createDatabase(file=process.env.DATABASE_FILE||'data/khodroto.db'){
 fs.mkdirSync(path.dirname(file),{recursive:true});const db=new DatabaseSync(file);db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;')
 db.exec(`CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY,phone TEXT UNIQUE NOT NULL,name TEXT DEFAULT 'کاربر خودروتو',city TEXT DEFAULT '1',role TEXT DEFAULT 'user',created_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS otp_codes(phone TEXT PRIMARY KEY,code_hash TEXT NOT NULL,expires_at INTEGER NOT NULL,attempts INTEGER DEFAULT 0);
 CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY,user_id INTEGER NOT NULL,expires_at INTEGER NOT NULL,created_at TEXT NOT NULL,FOREIGN KEY(user_id) REFERENCES users(id));
 CREATE TABLE IF NOT EXISTS listings(token TEXT PRIMARY KEY,title TEXT,city TEXT,price INTEGER,market INTEGER,score INTEGER,payload TEXT,first_seen_at TEXT,last_seen_at TEXT,category TEXT DEFAULT 'light',crawl_scope TEXT DEFAULT 'web:light:1',status TEXT DEFAULT 'active',missing_count INTEGER DEFAULT 0,last_verified_at TEXT,inactive_at TEXT,removed_at TEXT);
 CREATE TABLE IF NOT EXISTS price_history(id INTEGER PRIMARY KEY,token TEXT NOT NULL,price INTEGER NOT NULL,recorded_at TEXT NOT NULL,UNIQUE(token,price,recorded_at));
 CREATE TABLE IF NOT EXISTS listing_observations(token TEXT NOT NULL,observed_date TEXT NOT NULL,category TEXT DEFAULT 'light',PRIMARY KEY(token,observed_date));
 CREATE TABLE IF NOT EXISTS alerts(id INTEGER PRIMARY KEY,user_id INTEGER NOT NULL,title TEXT NOT NULL,filters TEXT NOT NULL,enabled INTEGER DEFAULT 1,created_at TEXT NOT NULL,FOREIGN KEY(user_id) REFERENCES users(id));
 CREATE TABLE IF NOT EXISTS saved_searches(id INTEGER PRIMARY KEY,user_id INTEGER NOT NULL,title TEXT NOT NULL,filters TEXT NOT NULL,created_at TEXT NOT NULL,FOREIGN KEY(user_id) REFERENCES users(id));
 CREATE TABLE IF NOT EXISTS subscriptions(id INTEGER PRIMARY KEY,user_id INTEGER NOT NULL,plan TEXT NOT NULL,status TEXT NOT NULL,amount INTEGER NOT NULL,started_at TEXT,expires_at TEXT,created_at TEXT NOT NULL,FOREIGN KEY(user_id) REFERENCES users(id));
 CREATE TABLE IF NOT EXISTS tickets(id INTEGER PRIMARY KEY,user_id INTEGER,subject TEXT NOT NULL,message TEXT NOT NULL,status TEXT DEFAULT 'open',created_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS crawler_runs(id INTEGER PRIMARY KEY,source TEXT,status TEXT,items_count INTEGER DEFAULT 0,pages_count INTEGER DEFAULT 0,error TEXT,started_at TEXT,finished_at TEXT);
 CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL,updated_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS service_integrations(id INTEGER PRIMARY KEY,kind TEXT NOT NULL CHECK(kind IN ('payment','sms')),name TEXT NOT NULL,provider TEXT NOT NULL,public_config TEXT NOT NULL DEFAULT '{}',secret_enc TEXT,enabled INTEGER DEFAULT 1,priority INTEGER DEFAULT 100,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS site_slides(id INTEGER PRIMARY KEY,title TEXT NOT NULL,subtitle TEXT,badge TEXT,cta_text TEXT,cta_link TEXT,image TEXT,theme TEXT DEFAULT 'navy',enabled INTEGER DEFAULT 1,sort_order INTEGER DEFAULT 100,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS audit_logs(id INTEGER PRIMARY KEY,admin_id INTEGER,action TEXT NOT NULL,entity TEXT NOT NULL,entity_id TEXT,details TEXT,created_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS dealer_inventory(id INTEGER PRIMARY KEY,user_id INTEGER NOT NULL,title TEXT NOT NULL,brand TEXT,model TEXT,year INTEGER,buy_price INTEGER DEFAULT 0,target_price INTEGER DEFAULT 0,status TEXT DEFAULT 'available',notes TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,FOREIGN KEY(user_id) REFERENCES users(id));
 CREATE TABLE IF NOT EXISTS dealer_leads(id INTEGER PRIMARY KEY,user_id INTEGER NOT NULL,name TEXT NOT NULL,phone TEXT,vehicle TEXT,budget INTEGER DEFAULT 0,status TEXT DEFAULT 'new',notes TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,FOREIGN KEY(user_id) REFERENCES users(id));
 CREATE TABLE IF NOT EXISTS alert_deliveries(id INTEGER PRIMARY KEY,alert_id INTEGER NOT NULL,user_id INTEGER,listing_id TEXT NOT NULL,message TEXT,status TEXT DEFAULT 'queued',created_at TEXT NOT NULL,UNIQUE(alert_id,listing_id));
 CREATE INDEX IF NOT EXISTS idx_alert_deliveries ON alert_deliveries(alert_id,created_at);
 CREATE TABLE IF NOT EXISTS saved_listings(user_id INTEGER NOT NULL,token TEXT NOT NULL,payload TEXT,created_at TEXT NOT NULL,PRIMARY KEY(user_id,token));
 CREATE INDEX IF NOT EXISTS idx_saved_listings ON saved_listings(user_id,created_at);
 CREATE TABLE IF NOT EXISTS seller_reputation(seller_key TEXT PRIMARY KEY,label TEXT,listings INTEGER DEFAULT 0,rejected INTEGER DEFAULT 0,review INTEGER DEFAULT 0,avg_reference_ratio REAL,updated_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS baseline_history(id INTEGER PRIMARY KEY,category TEXT NOT NULL,cohort_key TEXT NOT NULL,year INTEGER DEFAULT 0,color TEXT DEFAULT '',samples INTEGER,median INTEGER,avg INTEGER,captured_on TEXT NOT NULL,UNIQUE(category,cohort_key,year,color,captured_on));
 CREATE INDEX IF NOT EXISTS idx_baseline_history ON baseline_history(category,cohort_key,captured_on);
 CREATE TABLE IF NOT EXISTS listing_details(token TEXT PRIMARY KEY,color TEXT,km INTEGER DEFAULT 0,year INTEGER DEFAULT 0,fetched_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS reference_prices(source TEXT NOT NULL,cohort_key TEXT NOT NULL,year INTEGER NOT NULL,brand TEXT,model TEXT,trim TEXT,label TEXT,price INTEGER NOT NULL,condition TEXT,url TEXT,fetched_at TEXT NOT NULL,PRIMARY KEY(source,cohort_key,year,trim));
 CREATE INDEX IF NOT EXISTS idx_reference_lookup ON reference_prices(cohort_key,year);
 CREATE TABLE IF NOT EXISTS reference_runs(id INTEGER PRIMARY KEY,source TEXT NOT NULL,ok INTEGER DEFAULT 0,rows INTEGER DEFAULT 0,raw INTEGER DEFAULT 0,note TEXT,ms INTEGER,created_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS market_baseline(category TEXT NOT NULL,cohort_key TEXT NOT NULL,year INTEGER NOT NULL DEFAULT 0,color TEXT NOT NULL DEFAULT '',segment TEXT,vehicle_type TEXT,brand TEXT,model TEXT,label TEXT,samples INTEGER NOT NULL,avg INTEGER NOT NULL,median INTEGER NOT NULL,p25 INTEGER,p75 INTEGER,min INTEGER,max INTEGER,mad INTEGER,dispersion REAL,window_days INTEGER,generated_at TEXT NOT NULL,PRIMARY KEY(category,cohort_key,year,color));
 CREATE INDEX IF NOT EXISTS idx_baseline_lookup ON market_baseline(category,cohort_key,year,color);
 CREATE TABLE IF NOT EXISTS subscription_plans(id TEXT PRIMARY KEY,name TEXT NOT NULL,price INTEGER DEFAULT 0,description TEXT,features TEXT DEFAULT '[]',enabled INTEGER DEFAULT 1,popular INTEGER DEFAULT 0,sort_order INTEGER DEFAULT 100,updated_at TEXT NOT NULL);`)
 const listingColumns=new Set(db.prepare('PRAGMA table_info(listings)').all().map(column=>column.name));
 const listingMigrations={category:"TEXT DEFAULT 'light'",crawl_scope:"TEXT DEFAULT 'web:light:1'",status:"TEXT DEFAULT 'active'",missing_count:'INTEGER DEFAULT 0',last_verified_at:'TEXT',inactive_at:'TEXT',removed_at:'TEXT'};
 for(const [column,type] of Object.entries(listingMigrations))if(!listingColumns.has(column))db.exec(`ALTER TABLE listings ADD COLUMN ${column} ${type}`)
 db.exec("UPDATE listings SET category=COALESCE(category,'light'),crawl_scope=COALESCE(crawl_scope,'web:'||COALESCE(category,'light')||':1'),status=COALESCE(status,'active'),missing_count=COALESCE(missing_count,0)")
 const slideCount=db.prepare('SELECT COUNT(*) n FROM site_slides').get().n;if(!slideCount){const add=db.prepare('INSERT INTO site_slides(title,subtitle,badge,cta_text,cta_link,image,theme,enabled,sort_order,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)'),stamp=now();add.run('بازار را با عدد ببین، نه با حدس','هزاران آگهی هر روز مقایسه می‌شوند تا قیمت واقعی و فرصت‌های قابل بررسی روشن شوند.','تحلیل هوشمند بازار','شروع جست‌وجو','/cars','/banners/market-analysis.jpg','navy',1,1,stamp,stamp);add.run('فرصت طلایی قبل از بقیه','خودروهای زیر قیمت بازار را با کنترل ریسک و دلیل شفاف پیدا کن.','فرصت‌های امروز','دیدن فرصت‌ها','/#opportunities','/banners/golden-opportunity.jpg','gold',1,2,stamp,stamp);add.run('هشدار هوشمند؛ درست در زمان مناسب','فیلترت را ذخیره کن تا فرصت تازه مطابق بودجه و مدل دلخواهت را از دست ندهی.','اعلان خودروتو','ساخت هشدار','/dashboard','/banners/smart-alerts.jpg','teal',1,3,stamp,stamp)}
 const planSeed=db.prepare('INSERT OR IGNORE INTO subscription_plans(id,name,price,description,features,enabled,popular,sort_order,updated_at) VALUES(?,?,?,?,?,?,?,?,?)'),planStamp=now();planSeed.run('free','رایگان',0,'برای آشنایی با بازار',json(['۶ فرصت برتر','فیلترهای پایه','لینک مستقیم دیوار']),1,0,1,planStamp);planSeed.run('pro','خودروتو پرو',199000,'برای خرید جدی خودرو',json(['مشاهده همه فرصت‌ها','فیلتر کامل خودرو','تحلیل آگهی مشکوک','ذخیره و اعلان هوشمند','تاریخچه قیمت']),1,1,2,planStamp);planSeed.run('dealer','نمایشگاه حرفه‌ای',499000,'برای معامله‌گران و نمایشگاه‌ها',json(['پنل موجودی خودرو و قیمت هدف','مدیریت مشتری و سرنخ فروش','گزارش سود موجودی و بازار','خروجی CSV موجودی و مشتریان','۵ پایش هم‌زمان بازار']),1,0,3,planStamp);db.prepare("UPDATE subscription_plans SET features=?,updated_at=? WHERE id='dealer' AND features LIKE '%ابزارهای نمایشگاهی%'").run(json(['پنل موجودی خودرو و قیمت هدف','مدیریت مشتری و سرنخ فروش','گزارش سود موجودی و بازار','خروجی CSV موجودی و مشتریان','۵ پایش هم‌زمان بازار']),planStamp);
 const defaults={site_name:'خودروتو',site_tagline:'ماشین خوب، قیمت درست',support_phone:'',support_email:'',free_results:'6',cache_minutes:'10',maintenance_mode:'false',card_golden:'1',card_good:'2',card_fair:'4',card_expensive:'5',card_suspicious:'6',mobile_listing_mode:'carousel',hero_title:'ماشین خوب را قبل از بقیه پیدا کن.',hero_description:'آگهی‌ها را با قیمت بازار مقایسه و فرصت واقعی را پیدا کن.',section_slider:'true',section_search:'true',section_opportunities:'true',section_campaign:'true',section_method:'true',section_score:'true',section_faq:'true',feature_comparison:'true',feature_alerts:'true',feature_pricing:'true',score_golden_min:'85',score_good_min:'70',opportunity_min_discount:'15',opportunity_max_discount:'30',hide_dealer_ads:'true',seller_reputation_min_ads:'5',source_bama:'false',source_sheypoor:'false',source_ring:'false',source_khodro45:'false',source_hamrahmechanic:'false',hero_ticker:'فرصت تازه پیدا شد|پژو ۲۰۷ · ۱۲٪ زیر قیمت بازار|۹۱\nیک انتخاب طلایی|دنا پلاس · ۹٪ زیر قیمت بازار|۸۷\nقیمت منصفانه پیدا شد|تارا اتوماتیک · آگهی تازه تهران|۷۹',vehicle_categories:'light | سواری و وانت\nheavy | خودرو سنگین و نیمه‌سنگین\nmotorcycles | موتورسیکلت\nparts-accessories | قطعات یدکی و لوازم جانبی\nvehicles-services | خدمات خودرو و موتورسیکلت',vehicle_brands:'ایران خودرو\nسایپا\nپژو\nرنو\nمدیران خودرو\nکرمان موتور\nبهمن موتور\nفردا موتور\nآرین پارس موتور\nماموت خودرو\nمکث موتور\nنیسان\nتویوتا\nهیوندای\nکیا\nمزدا\nمیتسوبیشی\nسوزوکی\nفولکس واگن\nاشکودا\nبی ام و\nمرسدس بنز\nپورشه\nلکسوس\nولوو\nفیدلیتی\nدیگنیتی\nفونیکس\nلاماری\nچری\nجک\nلیفان\nام وی ام\nهایما\nدانگ فنگ\nچانگان\nجیلی\nبسترن\nشاهین\nکوییک\nدنا\nتارا\nسمند',vehicle_models:'ایران خودرو | پژو ۲۰۶,پژو ۲۰۷,پژو پارس,دنا,دنا پلاس,تارا,رانا,سمند,سورن,هایما S5,هایما S7,هایما 8S\nسایپا | پراید,تیبا,ساینا,کوییک,شاهین,اطلس\nمدیران خودرو | ام وی ام 315,ام وی ام X22,ام وی ام X33,آریزو 5,آریزو 6,تیگو 5,تیگو 7,تیگو 8\nکرمان موتور | جک J4,جک J5,جک S3,جک S5,KMC K7,KMC T8,KMC J7\nبهمن موتور | مزدا 3,فیدلیتی,دیگنیتی,ریسپکت,کاپرا\nرنو | ال 90,ساندرو,استپ وی,مگان,کولیوس,تلیسمان\nتویوتا | کرولا,کمری,لندکروز,پرادو,راوفور,هایلوکس\nهیوندای | اکسنت,النترا,سوناتا,آزرا,توسان,سانتافه\nکیا | پراید,ریو,سراتو,اپتیما,اسپورتیج,سورنتو',catalog_synced_at:'',supported_cities:'1 | تهران\n2 | کرج\n3 | مشهد\n4 | اصفهان\n6 | شیراز\n8 | تبریز\n5 | رشت\n10 | قم',vehicle_colors:'سفید\nمشکی\nخاکستری\nنقره‌ای\nآبی',default_city:'1',default_sort:'score',exclude_no_photo:'true',enable_motorcycles:'true',enable_heavy_vehicles:'true',about_content:'خودروتو موتور مستقل تحلیل بازار خودرو است.',contact_intro:'از طریق فرم تماس با تیم خودروتو در ارتباط باشید.',methodology_content:'قیمت هر آگهی با نمونه‌های مشابه بازار مقایسه می‌شود.',data_sources_content:'اطلاعات از آگهی‌های عمومی و منابع مجاز بازار گردآوری می‌شود.',terms_content:'استفاده از خودروتو به معنی پذیرش قوانین پلتفرم است.',privacy_content:'اطلاعات کاربران فقط برای ارائه خدمات نگهداری می‌شود.',legal_notice:'نتایج تحلیل جایگزین کارشناسی فنی و حقوقی خودرو نیست.',faq_content:'خودروتو چگونه قیمت را تحلیل می‌کند؟ | با مقایسه نمونه‌های مشابه بازار.\nآیا نتیجه تحلیل قطعی است؟ | خیر؛ بازدید و کارشناسی حضوری ضروری است.',faq_enabled:'true',faq_home_count:'6',header_links:'آگهی‌ها | /cars\nتخمین قیمت | /estimate\nمقایسه | /compare\nروش تحلیل | /methodology\nاشتراک | /pricing',footer_platform_links:'درباره ما | /about\nروش تحلیل | /methodology\nمنابع داده | /data-sources',footer_help_links:'سوالات متداول | /faq\nتماس با ما | /contact\nحریم خصوصی | /privacy',footer_description:'موتور مستقل جست‌وجو و تحلیل بازار خودرو.',social_links:'',copyright_text:'© ۱۴۰۵ خودروتو — همه حقوق محفوظ است.',notification_master:'true',sms_otp_enabled:'true',sms_alert_enabled:'true',email_enabled:'false',quiet_hours:'۲۲:۰۰ تا ۸:۰۰',otp_template:'کد ورود خودروتو: {{code}}',opportunity_template:'فرصت تازه مطابق جست‌وجوی شما پیدا شد.',subscription_template:'اشتراک {{plan}} شما فعال شد.',seo_title:'خودروتو | تحلیل هوشمند بازار خودرو',seo_description:'جست‌وجو، مقایسه و تحلیل فرصت‌های بازار خودرو',seo_keywords:'خودرو، قیمت خودرو، آگهی خودرو، مقایسه خودرو',canonical_url:'',robots_index:'true',og_title:'خودروتو؛ ماشین خوب، قیمت درست',og_description:'فرصت‌های بازار خودرو را هوشمندانه پیدا کنید.',og_image:'/khodroto-market-banner.jpg',organization_schema:'',brand_primary:'#17324f',brand_accent:'#e86f54',logo_url:'/brand/khodroto-mark.svg',favicon_url:'/brand/khodroto-mark.svg',public_font_scale:'normal',show_announcement:'true',enable_motion:'true',dark_mode_available:'false',otp_expiry_minutes:'2',max_login_attempts:'8',admin_session_hours:'12',force_secure_cookie:'true',allow_admin_role_change:'true',audit_retention_days:'365',maintenance_allow_admin:'true',backup_enabled:'false',backup_schedule:'daily',backup_retention:'7',backup_destination:'storage خارج از سرور',log_retention_days:'90',inactive_listing_days:'30',healthcheck_enabled:'true',campaign_enabled:'true',campaign_title:'فرصت خوب منتظر نمی‌ماند.',campaign_description:'با اشتراک حرفه‌ای فرصت‌ها را زودتر ببینید.',campaign_discount:'30',campaign_cta:'دیدن پلن‌ها',discount_code:'',discount_percent:'0',discount_expires:'',discount_usage_limit:'0',crawler_max_pages:'0',crawler_cities:'all',crawler_queries:'خودرو',analysis_enabled:'true'};const settingInsert=db.prepare('INSERT OR IGNORE INTO settings(key,value,updated_at) VALUES(?,?,?)');for(const [key,value]of Object.entries(defaults))settingInsert.run(key,value,now())
 const hash=v=>crypto.createHash('sha256').update(v).digest('hex')
 const configuredCredentialKey=String(process.env.CREDENTIALS_ENCRYPTION_KEY||'')
 const credentialKey=configuredCredentialKey?crypto.createHash('sha256').update(configuredCredentialKey).digest():process.env.NODE_ENV==='production'?null:crypto.createHash('sha256').update('khodroto-development-credentials-key').digest()
 function encryptSecret(value){if(!value)return null;if(!credentialKey){const error=new Error('CREDENTIALS_ENCRYPTION_KEY is required');error.code='ENCRYPTION_KEY_REQUIRED';throw error}const iv=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',credentialKey,iv),encrypted=Buffer.concat([cipher.update(String(value),'utf8'),cipher.final()]);return [iv.toString('base64url'),cipher.getAuthTag().toString('base64url'),encrypted.toString('base64url')].join('.')}
 function decryptSecret(value){if(!value||!credentialKey)return'';try{const[iv,tag,data]=String(value).split('.'),decipher=crypto.createDecipheriv('aes-256-gcm',credentialKey,Buffer.from(iv,'base64url'));decipher.setAuthTag(Buffer.from(tag,'base64url'));return Buffer.concat([decipher.update(Buffer.from(data,'base64url')),decipher.final()]).toString('utf8')}catch{return''}}
 const parseConfig=value=>{try{return JSON.parse(value||'{}')}catch{return{}}}
 function integrations(kind){return db.prepare('SELECT id,kind,name,provider,public_config,secret_enc,enabled,priority,created_at,updated_at FROM service_integrations WHERE kind=? ORDER BY enabled DESC,priority ASC,id DESC').all(kind).map(row=>({...row,config:parseConfig(row.public_config),enabled:Boolean(row.enabled),hasSecret:Boolean(row.secret_enc),secret_enc:undefined}))}
 function saveIntegration(kind,data,id=null){if(!['payment','sms'].includes(kind))throw new Error('INVALID_KIND');const stamp=now(),name=String(data.name||'').trim().slice(0,80),provider=String(data.provider||'custom').trim().slice(0,50),config=json(data.config||{}),enabled=data.enabled===false?0:1,priority=Math.max(0,Math.min(9999,Number.isFinite(Number(data.priority))?Number(data.priority):100));if(name.length<2)throw new Error('INVALID_NAME');if(id){const current=db.prepare('SELECT secret_enc FROM service_integrations WHERE id=? AND kind=?').get(id,kind);if(!current)return null;const secret=data.secret?encryptSecret(String(data.secret).slice(0,4000)):current.secret_enc;db.prepare('UPDATE service_integrations SET name=?,provider=?,public_config=?,secret_enc=?,enabled=?,priority=?,updated_at=? WHERE id=? AND kind=?').run(name,provider,config,secret,enabled,priority,stamp,id,kind)}else{db.prepare('INSERT INTO service_integrations(kind,name,provider,public_config,secret_enc,enabled,priority,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)').run(kind,name,provider,config,encryptSecret(String(data.secret||'').slice(0,4000)),enabled,priority,stamp,stamp)}return integrations(kind)}
 function deleteIntegration(kind,id){return db.prepare('DELETE FROM service_integrations WHERE id=? AND kind=?').run(id,kind)}
 function activeIntegrations(kind){return db.prepare('SELECT id,name,provider,public_config,secret_enc,priority FROM service_integrations WHERE kind=? AND enabled=1 ORDER BY priority ASC,id ASC').all(kind).map(row=>({...row,config:parseConfig(row.public_config),secret:decryptSecret(row.secret_enc),public_config:undefined,secret_enc:undefined}))}
 function storeCrawl(result={},options={}){
  const items=Array.isArray(result.items)?result.items:[],category=String(options.category||result.category||'light'),scope=String(options.scope||result.scope||`web:${category}:1`),stamp=now()
  const observed=[...new Set((result.observedTokens||items.map(item=>item.id)).filter(Boolean).map(String))]
  const up=db.prepare(`INSERT INTO listings(token,title,city,price,market,score,payload,first_seen_at,last_seen_at,category,crawl_scope,status,missing_count,last_verified_at,inactive_at,removed_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,'active',0,?,NULL,NULL) ON CONFLICT(token) DO UPDATE SET title=excluded.title,city=excluded.city,price=excluded.price,market=excluded.market,score=excluded.score,payload=excluded.payload,last_seen_at=excluded.last_seen_at,category=excluded.category,crawl_scope=excluded.crawl_scope,status='active',missing_count=0,last_verified_at=excluded.last_verified_at,inactive_at=NULL,removed_at=NULL`)
  const hist=db.prepare('INSERT OR IGNORE INTO price_history(token,price,recorded_at) VALUES(?,?,?)')
  db.exec('CREATE TEMP TABLE IF NOT EXISTS crawl_seen_tokens(token TEXT PRIMARY KEY)')
  const seen=db.prepare('INSERT OR IGNORE INTO crawl_seen_tokens(token) VALUES(?)')
  const observation=db.prepare('INSERT OR IGNORE INTO listing_observations(token,observed_date,category) VALUES(?,?,?)')
  db.exec('BEGIN')
  try{
   db.exec('CREATE TEMP TABLE IF NOT EXISTS crawl_seen_tokens(token TEXT PRIMARY KEY);DELETE FROM crawl_seen_tokens;')
   for(const token of observed){seen.run(token);observation.run(token,tehranDate(),category)}
   for(const item of items){if(!item?.id)continue;up.run(item.id,item.title,item.city,item.price,item.market,item.score,json(item),stamp,stamp,category,scope,stamp);hist.run(item.id,item.price,stamp.slice(0,16))}
   db.prepare(`UPDATE listings SET last_seen_at=?,last_verified_at=?,missing_count=0,status='active',inactive_at=NULL,removed_at=NULL WHERE token IN (SELECT token FROM crawl_seen_tokens)`).run(stamp,stamp)
   if(options.reconcile){
    db.prepare(`UPDATE listings SET missing_count=missing_count+1,status=CASE WHEN missing_count+1>=3 THEN 'inactive' ELSE 'stale' END,inactive_at=CASE WHEN missing_count+1>=3 THEN COALESCE(inactive_at,?) ELSE inactive_at END WHERE crawl_scope=? AND status!='removed' AND token NOT IN (SELECT token FROM crawl_seen_tokens)`).run(stamp,scope)
   }
   db.exec('COMMIT')
  }catch(e){db.exec('ROLLBACK');throw e}
  return{stored:items.length,observed:observed.length,reconciled:Boolean(options.reconcile)}
 }
 function storeListings(items=[]){return storeCrawl({items},{reconcile:false})}
 function verificationCandidates(category='light',limit=25){return db.prepare(`SELECT token,status,missing_count FROM listings WHERE category=? AND status IN ('stale','inactive') ORDER BY missing_count DESC,last_seen_at ASC LIMIT ?`).all(category,limit)}
 function markListingVerification(token,state){const stamp=now();if(state==='removed')return db.prepare(`UPDATE listings SET status='removed',removed_at=COALESCE(removed_at,?),last_verified_at=? WHERE token=?`).run(stamp,stamp,token);if(state==='active')return db.prepare(`UPDATE listings SET status='active',missing_count=0,last_seen_at=?,last_verified_at=?,inactive_at=NULL,removed_at=NULL WHERE token=?`).run(stamp,stamp,token)}
 function publicStats(){
  const today=tehranDate()
  return{
   analyzedToday:db.prepare('SELECT COUNT(*) n FROM listing_observations WHERE observed_date=?').get(today).n,
   totalListings:db.prepare('SELECT COUNT(*) n FROM listings').get().n,
   goldenOpportunities:db.prepare("SELECT COUNT(*) n FROM listings WHERE status='active' AND score>=85").get().n,
   activeListings:db.prepare("SELECT COUNT(*) n FROM listings WHERE status='active'").get().n,
   date:today,
  }
 }
 function slides(activeOnly=false){return db.prepare(`SELECT * FROM site_slides ${activeOnly?'WHERE enabled=1':''} ORDER BY sort_order ASC,id ASC`).all().map(row=>({...row,enabled:Boolean(row.enabled)}))}
 function saveSlide(data,id=null){const stamp=now(),values=[String(data.title||'').trim().slice(0,150),String(data.subtitle||'').trim().slice(0,500),String(data.badge||'').trim().slice(0,80),String(data.cta_text||'').trim().slice(0,80),String(data.cta_link||'/cars').trim().slice(0,500),String(data.image||'').trim().slice(0,500),['navy','gold','teal','coral'].includes(data.theme)?data.theme:'navy',data.enabled===false?0:1,Math.max(0,Number.isFinite(Number(data.sort_order))?Number(data.sort_order):100)];if(values[0].length<2)throw new Error('INVALID_TITLE');if(id){db.prepare('UPDATE site_slides SET title=?,subtitle=?,badge=?,cta_text=?,cta_link=?,image=?,theme=?,enabled=?,sort_order=?,updated_at=? WHERE id=?').run(...values,stamp,id)}else db.prepare('INSERT INTO site_slides(title,subtitle,badge,cta_text,cta_link,image,theme,enabled,sort_order,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(...values,stamp,stamp);return slides()}
 function deleteSlide(id){return db.prepare('DELETE FROM site_slides WHERE id=?').run(id)}
 function audit(adminId,action,entity,entityId='',details={}){db.prepare('INSERT INTO audit_logs(admin_id,action,entity,entity_id,details,created_at) VALUES(?,?,?,?,?,?)').run(adminId||null,String(action).slice(0,80),String(entity).slice(0,80),String(entityId).slice(0,100),json(details),now())}
 function audits(){return db.prepare('SELECT a.*,u.name admin_name,u.phone admin_phone FROM audit_logs a LEFT JOIN users u ON u.id=a.admin_id ORDER BY a.id DESC LIMIT 250').all()}
 function requestOtp(phone){const code=String(Math.floor(10000+Math.random()*90000));db.prepare('INSERT INTO otp_codes(phone,code_hash,expires_at,attempts) VALUES(?,?,?,0) ON CONFLICT(phone) DO UPDATE SET code_hash=excluded.code_hash,expires_at=excluded.expires_at,attempts=0').run(phone,hash(code),Date.now()+120000);return code}
 // SECURITY: admin rights are granted ONLY to the configured ADMIN_PHONE, or when
 // DEV_AUTO_ADMIN=true is set deliberately. This used to read
 // `NODE_ENV!=='production'`, which meant that on any host where NODE_ENV happened
 // to be unset — `npm start` runs plain `node server.js`, and only app.js sets it —
 // EVERY person who logged in with an OTP silently became an administrator with
 // full access to users, settings, exports and the crawler.
 function verifyOtp(phone,code){const row=db.prepare('SELECT * FROM otp_codes WHERE phone=?').get(phone);if(!row||row.expires_at<Date.now()||row.attempts>=5)return null;if(row.code_hash!==hash(code)){db.prepare('UPDATE otp_codes SET attempts=attempts+1 WHERE phone=?').run(phone);return null}db.prepare('DELETE FROM otp_codes WHERE phone=?').run(phone);db.prepare('INSERT OR IGNORE INTO users(phone,created_at) VALUES(?,?)').run(phone,now());if(process.env.ADMIN_PHONE===phone||process.env.DEV_AUTO_ADMIN==='true')db.prepare("UPDATE users SET role='admin' WHERE phone=?").run(phone);const user=db.prepare('SELECT * FROM users WHERE phone=?').get(phone),token=crypto.randomBytes(32).toString('hex');db.prepare('INSERT INTO sessions(token_hash,user_id,expires_at,created_at) VALUES(?,?,?,?)').run(hash(token),user.id,Date.now()+30*86400000,now());return{user,token}}
 function userFromToken(token){if(!token)return null;return db.prepare('SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?').get(hash(token),Date.now())||null}
 function createAdminSession(phone){const normalized=String(phone||process.env.ADMIN_PHONE||'').trim();if(!/^09\d{9}$/.test(normalized))return null;db.prepare('INSERT OR IGNORE INTO users(phone,created_at) VALUES(?,?)').run(normalized,now());db.prepare("UPDATE users SET role='admin' WHERE phone=?").run(normalized);const user=db.prepare('SELECT * FROM users WHERE phone=?').get(normalized),token=crypto.randomBytes(32).toString('hex');db.prepare('INSERT INTO sessions(token_hash,user_id,expires_at,created_at) VALUES(?,?,?,?)').run(hash(token),user.id,Date.now()+12*60*60*1000,now());return{user,token}}
 function plans(activeOnly=false){return db.prepare(`SELECT * FROM subscription_plans ${activeOnly?'WHERE enabled=1':''} ORDER BY sort_order,id`).all().map(row=>({...row,enabled:Boolean(row.enabled),popular:Boolean(row.popular),features:parseConfig(row.features)}))}function savePlan(id,data){const current=db.prepare('SELECT * FROM subscription_plans WHERE id=?').get(id);if(!current)return null;db.prepare('UPDATE subscription_plans SET name=?,price=?,description=?,features=?,enabled=?,popular=?,sort_order=?,updated_at=? WHERE id=?').run(String(data.name||current.name).slice(0,80),Math.max(0,Number(data.price??current.price)||0),String(data.description??current.description).slice(0,200),json(Array.isArray(data.features)?data.features:String(data.features||'').split('\n').filter(Boolean)),data.enabled===false?0:1,data.popular?1:0,Number(data.sort_order??current.sort_order)||100,now(),id);return plans()}
 function dealerInventory(userId){return db.prepare('SELECT * FROM dealer_inventory WHERE user_id=? ORDER BY id DESC').all(userId)}
 function saveDealerInventory(userId,data,id=null){const stamp=now(),values=[String(data.title||'').trim().slice(0,120),String(data.brand||'').slice(0,60),String(data.model||'').slice(0,80),Number(data.year)||0,Math.max(0,Number(data.buy_price)||0),Math.max(0,Number(data.target_price)||0),['available','reserved','sold','repair'].includes(data.status)?data.status:'available',String(data.notes||'').slice(0,1000)];if(values[0].length<2)throw new Error('INVALID_TITLE');if(id){const result=db.prepare('UPDATE dealer_inventory SET title=?,brand=?,model=?,year=?,buy_price=?,target_price=?,status=?,notes=?,updated_at=? WHERE id=? AND user_id=?').run(...values,stamp,id,userId);if(!result.changes)return null}else db.prepare('INSERT INTO dealer_inventory(user_id,title,brand,model,year,buy_price,target_price,status,notes,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(userId,...values,stamp,stamp);return dealerInventory(userId)}
 function deleteDealerInventory(userId,id){return db.prepare('DELETE FROM dealer_inventory WHERE id=? AND user_id=?').run(id,userId)}
 function dealerLeads(userId){return db.prepare('SELECT * FROM dealer_leads WHERE user_id=? ORDER BY id DESC').all(userId)}
 function saveDealerLead(userId,data,id=null){const stamp=now(),values=[String(data.name||'').trim().slice(0,100),String(data.phone||'').slice(0,30),String(data.vehicle||'').slice(0,120),Math.max(0,Number(data.budget)||0),['new','contacted','negotiating','won','lost'].includes(data.status)?data.status:'new',String(data.notes||'').slice(0,1000)];if(values[0].length<2)throw new Error('INVALID_NAME');if(id){const result=db.prepare('UPDATE dealer_leads SET name=?,phone=?,vehicle=?,budget=?,status=?,notes=?,updated_at=? WHERE id=? AND user_id=?').run(...values,stamp,id,userId);if(!result.changes)return null}else db.prepare('INSERT INTO dealer_leads(user_id,name,phone,vehicle,budget,status,notes,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)').run(userId,...values,stamp,stamp);return dealerLeads(userId)}
 function deleteDealerLead(userId,id){return db.prepare('DELETE FROM dealer_leads WHERE id=? AND user_id=?').run(id,userId)}
 function listPayloads(category='light'){
  return db.prepare("SELECT payload,last_seen_at FROM listings WHERE category=? AND status='active'").all(category)
   .map(row=>{try{return{...JSON.parse(row.payload||'{}'),lastSeenAt:row.last_seen_at}}catch{return null}})
   .filter(Boolean)
 }
 // Cheap freshness signature so higher layers can memoize expensive analysis per category.
 function listingsSignature(category='light'){
  const row=db.prepare("SELECT COUNT(*) n,MAX(last_seen_at) m FROM listings WHERE category=? AND status='active'").get(category)
  return `${row.n}:${row.m||''}`
 }
 // Tokens we already hold for a category, used by the incremental crawler to stop
 // paging once it reaches listings it has seen before.
 function knownTokens(category='light',days=45){
  const cutoff=new Date(Date.now()-days*86400000).toISOString()
  return new Set(db.prepare('SELECT token FROM listings WHERE category=? AND last_seen_at>=?').all(category,cutoff).map(row=>row.token))
 }

 // --- Alert delivery ----------------------------------------------------------
 // The alerts table existed but nothing was ever sent. These helpers make delivery
 // idempotent: an alert fires at most once per listing, forever.
 function enabledAlerts(){
  return db.prepare('SELECT a.id,a.user_id,a.title,a.filters,u.phone FROM alerts a JOIN users u ON u.id=a.user_id WHERE a.enabled=1').all()
 }
 function alertAlreadySent(alertId,listingId){
  return Boolean(db.prepare('SELECT 1 FROM alert_deliveries WHERE alert_id=? AND listing_id=?').get(alertId,String(listingId)))
 }
 function recordAlertDelivery(alertId,userId,listingId,message,status='queued'){
  try{db.prepare('INSERT OR IGNORE INTO alert_deliveries(alert_id,user_id,listing_id,message,status,created_at) VALUES(?,?,?,?,?,?)')
   .run(alertId,userId||null,String(listingId),String(message||'').slice(0,500),status,now())}catch{}
 }
 function pendingAlertDeliveries(limit=100){return db.prepare("SELECT * FROM alert_deliveries WHERE status='queued' ORDER BY id LIMIT ?").all(limit)}
 function markAlertDelivered(id,status='sent'){db.prepare('UPDATE alert_deliveries SET status=? WHERE id=?').run(status,id)}
 function alertHistory(userId,limit=50){return db.prepare('SELECT * FROM alert_deliveries WHERE user_id=? ORDER BY id DESC LIMIT ?').all(userId,limit)}

 // --- In-app notifications ----------------------------------------------------
 // An alert that only ever becomes an SMS is invisible to a user who is already
 // on the site, and unverifiable when the SMS provider is down.
 const deliveryColumns=new Set(db.prepare('PRAGMA table_info(alert_deliveries)').all().map(row=>row.name))
 if(!deliveryColumns.has('read_at'))db.exec('ALTER TABLE alert_deliveries ADD COLUMN read_at TEXT')
 function notifications(userId,limit=30){
  return db.prepare('SELECT d.id,d.listing_id,d.message,d.status,d.created_at,d.read_at,a.title FROM alert_deliveries d LEFT JOIN alerts a ON a.id=d.alert_id WHERE d.user_id=? ORDER BY d.id DESC LIMIT ?').all(userId,limit)
 }
 function unreadNotifications(userId){
  return db.prepare('SELECT COUNT(*) n FROM alert_deliveries WHERE user_id=? AND read_at IS NULL').get(userId).n
 }
 function markNotificationsRead(userId,ids=null){
  if(Array.isArray(ids)&&ids.length){
   const clause=ids.map(()=>'?').join(',')
   return db.prepare(`UPDATE alert_deliveries SET read_at=? WHERE user_id=? AND read_at IS NULL AND id IN (${clause})`).run(now(),userId,...ids).changes
  }
  return db.prepare('UPDATE alert_deliveries SET read_at=? WHERE user_id=? AND read_at IS NULL').run(now(),userId).changes
 }

 // --- Saved listings ----------------------------------------------------------
 // These lived in localStorage, so they vanished on a new browser and could never
 // be used by anything server-side.
 function saveListing(userId,token,payload){
  db.prepare('INSERT OR REPLACE INTO saved_listings(user_id,token,payload,created_at) VALUES(?,?,?,COALESCE((SELECT created_at FROM saved_listings WHERE user_id=? AND token=?),?))')
   .run(userId,String(token),json(payload||{}),userId,String(token),now())
  return true
 }
 function unsaveListing(userId,token){return db.prepare('DELETE FROM saved_listings WHERE user_id=? AND token=?').run(userId,String(token)).changes>0}
 function savedListings(userId,limit=200){
  return db.prepare('SELECT token,payload,created_at FROM saved_listings WHERE user_id=? ORDER BY created_at DESC LIMIT ?').all(userId,limit)
   .map(row=>{try{return{...JSON.parse(row.payload||'{}'),token:row.token,id:row.token,savedAt:row.created_at}}catch{return{token:row.token,id:row.token,savedAt:row.created_at}}})
 }
 function savedTokens(userId){return db.prepare('SELECT token FROM saved_listings WHERE user_id=?').all(userId).map(row=>row.token)}

 // --- Analytics ---------------------------------------------------------------
 // Daily series for the admin charts. All three were already in the database and
 // only ever shown as a single total.
 function analyticsSeries(days=30){
  const since=new Date(Date.now()-days*86400000).toISOString()
  const fill=rows=>{
   const byDay=new Map(rows.map(row=>[row.day,Number(row.value)||0]))
   return Array.from({length:days},(_,index)=>{
    const day=new Date(Date.now()-(days-1-index)*86400000).toISOString().slice(0,10)
    return{day,value:byDay.get(day)||0}
   })
  }
  return{
   days,
   revenue:fill(db.prepare("SELECT substr(COALESCE(started_at,created_at),1,10) day,SUM(amount) value FROM subscriptions WHERE COALESCE(started_at,created_at)>=? AND status='active' GROUP BY day").all(since)),
   signups:fill(db.prepare('SELECT substr(created_at,1,10) day,COUNT(*) value FROM users WHERE created_at>=? GROUP BY day').all(since)),
   analyzed:fill(db.prepare('SELECT observed_date day,COUNT(*) value FROM listing_observations WHERE observed_date>=? GROUP BY day').all(since.slice(0,10))),
   alerts:fill(db.prepare('SELECT substr(created_at,1,10) day,COUNT(*) value FROM alert_deliveries WHERE created_at>=? GROUP BY day').all(since)),
  }
 }

 // --- Seller reputation -------------------------------------------------------
 // A dealer who floods the market with bait prices should be visible as such.
 function recordSellerStats(rows){
  const upsert=db.prepare('INSERT OR REPLACE INTO seller_reputation(seller_key,label,listings,rejected,review,avg_reference_ratio,updated_at) VALUES(?,?,?,?,?,?,?)')
  db.exec('BEGIN')
  try{for(const row of rows)upsert.run(row.key,row.label||'',row.listings||0,row.rejected||0,row.review||0,row.avgRatio||null,now());db.exec('COMMIT')}
  catch(error){db.exec('ROLLBACK');throw error}
  return rows.length
 }
 function sellerReputation(key){return db.prepare('SELECT * FROM seller_reputation WHERE seller_key=?').get(key)||null}
 function worstSellers(limit=20){return db.prepare('SELECT * FROM seller_reputation WHERE listings>=5 ORDER BY (CAST(rejected AS REAL)/listings) DESC,listings DESC LIMIT ?').all(limit)}

 // --- Baseline history (market trend) -----------------------------------------
 // replaceBaseline() overwrites today's numbers; this keeps one daily snapshot so
 // «قیمت کوییک در ۳۰ روز گذشته» can be drawn.
 function snapshotBaseline(category,rows){
  const day=new Date().toISOString().slice(0,10)
  const insert=db.prepare('INSERT OR REPLACE INTO baseline_history(category,cohort_key,year,color,samples,median,avg,captured_on) VALUES(?,?,?,?,?,?,?,?)')
  db.exec('BEGIN')
  try{for(const row of rows)insert.run(category,row.cohortKey,Number(row.year)||0,String(row.color||''),row.samples,row.median,row.avg,day);db.exec('COMMIT')}
  catch(error){db.exec('ROLLBACK');throw error}
  return{category,day,rows:rows.length}
 }
 function baselineTrend(category,cohortKey,{year=0,color='',days=90}={}){
  const since=new Date(Date.now()-days*86400000).toISOString().slice(0,10)
  return db.prepare('SELECT captured_on,samples,median,avg FROM baseline_history WHERE category=? AND cohort_key=? AND year=? AND color=? AND captured_on>=? ORDER BY captured_on').all(category,cohortKey,Number(year)||0,String(color||''),since)
 }
 function pruneBaselineHistory(keepDays=365){
  const cutoff=new Date(Date.now()-keepDays*86400000).toISOString().slice(0,10)
  return db.prepare('DELETE FROM baseline_history WHERE captured_on<?').run(cutoff).changes
 }

 // --- Listing detail cache ----------------------------------------------------
 // The Divar search endpoint never returns colour or mileage; only the detail page
 // does. Caching what we fetch means coverage accumulates every cycle instead of
 // re-paying for the same tokens, which is what finally makes per-colour averages
 // possible.
 // The showroom behind an ad is only visible on its detail page, so it is cached
 // alongside colour and mileage — otherwise every reputation lookup would need a
 // fresh fetch and the table would never fill.
 const detailColumns=new Set(db.prepare('PRAGMA table_info(listing_details)').all().map(row=>row.name))
 for(const [column,type] of Object.entries({seller_key:'TEXT',seller_name:'TEXT'})){
  if(!detailColumns.has(column))db.exec(`ALTER TABLE listing_details ADD COLUMN ${column} ${type}`)
 }
 const detailCache={
  get(token){
   const row=db.prepare('SELECT color,km,year,seller_key,seller_name FROM listing_details WHERE token=?').get(token)
   return row?{color:row.color||'—',km:row.km||0,year:row.year||0,sellerKey:row.seller_key||'',sellerName:row.seller_name||''}:null
  },
  set(token,fields){
   try{db.prepare('INSERT OR REPLACE INTO listing_details(token,color,km,year,seller_key,seller_name,fetched_at) VALUES(?,?,?,?,?,?,?)')
    .run(token,fields.color||'—',Number(fields.km)||0,Number(fields.year)||0,String(fields.sellerKey||''),String(fields.sellerName||''),now())}catch{}
  },
  stats(){return db.prepare("SELECT COUNT(*) total,SUM(CASE WHEN color<>'—' AND color<>'' THEN 1 ELSE 0 END) with_color,SUM(CASE WHEN km>0 THEN 1 ELSE 0 END) with_km FROM listing_details").get()},
 }

 // --- Reference prices (daily valuations from Iranian price authorities) -------
 // Independent of Divar: used to detect bait/instalment prices and to sanity-check
 // the averages we derive from listings.
 function replaceReferencePrices(source,rows,{fetchedAt=now()}={}){
  const insert=db.prepare('INSERT OR REPLACE INTO reference_prices(source,cohort_key,year,brand,model,trim,label,price,condition,url,fetched_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
  db.exec('BEGIN')
  try{
   db.prepare('DELETE FROM reference_prices WHERE source=?').run(source)
   for(const row of rows) insert.run(source,row.cohortKey,Number(row.year)||0,row.brand||'',row.model||'',row.trim||'',row.label||'',Math.round(Number(row.price)||0),row.condition||'',row.url||'',fetchedAt)
   db.exec('COMMIT')
  }catch(error){db.exec('ROLLBACK');throw error}
  return{source,rows:rows.length,fetchedAt}
 }
 // Manual overrides live in the same table under their own source, so the
 // automatic refresh (which deletes per source) never touches them.
 function upsertManualReference(row){
  db.prepare('INSERT OR REPLACE INTO reference_prices(source,cohort_key,year,brand,model,trim,label,price,condition,url,fetched_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
   .run('manual',String(row.cohortKey||''),Number(row.year)||0,row.brand||'',row.model||'',row.trim||'',row.label||'',Math.round(Number(row.price)||0),row.condition||'used',row.url||'',now())
  return{ok:true}
 }
 function deleteManualReference(cohortKey,year,trim=''){
  return db.prepare('DELETE FROM reference_prices WHERE source=? AND cohort_key=? AND year=? AND trim=?').run('manual',String(cohortKey),Number(year)||0,trim).changes>0
 }
 function manualReferences(){return db.prepare("SELECT * FROM reference_prices WHERE source='manual' ORDER BY cohort_key,year DESC").all().map(row=>({...row,cohortKey:row.cohort_key}))}

 function referencePrices(limit=5000){return db.prepare('SELECT * FROM reference_prices ORDER BY cohort_key,year DESC LIMIT ?').all(limit).map(row=>({...row,cohortKey:row.cohort_key}))}
 function referenceMeta(){return db.prepare('SELECT COUNT(*) rows,COUNT(DISTINCT cohort_key) models,MAX(fetched_at) fetched_at FROM reference_prices').get()}
 function logReferenceRun(entry){db.prepare('INSERT INTO reference_runs(source,ok,rows,raw,note,ms,created_at) VALUES(?,?,?,?,?,?,?)').run(entry.key||entry.source||'',entry.ok?1:0,entry.rows||0,entry.raw||0,entry.note||'',entry.ms||0,now())}
 function referenceRuns(limit=20){return db.prepare('SELECT * FROM reference_runs ORDER BY id DESC LIMIT ?').all(limit)}

 // --- Rolling market baseline -------------------------------------------------
 // Persisted average/median per (model, build year, colour) so pricing survives a
 // restart and so the admin can inspect exactly what the platform believes.
 function replaceBaseline(category,rows,{windowDays=30,generatedAt=now()}={}){
  const insert=db.prepare('INSERT OR REPLACE INTO market_baseline(category,cohort_key,year,color,segment,vehicle_type,brand,model,label,samples,avg,median,p25,p75,min,max,mad,dispersion,window_days,generated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
  db.exec('BEGIN')
  try{
   db.prepare('DELETE FROM market_baseline WHERE category=?').run(category)
   for(const row of rows) insert.run(category,row.cohortKey,Number(row.year)||0,String(row.color||''),row.segment||'',row.type||'',row.brand||'',row.model||'',row.label||'',row.samples,row.avg,row.median,row.p25||0,row.p75||0,row.min||0,row.max||0,row.mad||0,row.dispersion||0,windowDays,generatedAt)
   db.exec('COMMIT')
  }catch(error){db.exec('ROLLBACK');throw error}
  return{category,rows:rows.length,generatedAt,windowDays}
 }
 function baselineRows(category='light',limit=500){return db.prepare('SELECT * FROM market_baseline WHERE category=? ORDER BY samples DESC LIMIT ?').all(category,limit)}
 function baselineLookup(category,cohortKey,year=0,color=''){
  return db.prepare('SELECT * FROM market_baseline WHERE category=? AND cohort_key=? AND year=? AND color=?').get(category,cohortKey,Number(year)||0,String(color||''))||null
 }
 function baselineMeta(category='light'){return db.prepare('SELECT COUNT(*) rows,MAX(generated_at) generated_at,MAX(window_days) window_days FROM market_baseline WHERE category=?').get(category)}
 // Listings seen inside the rolling window — the input the baseline is built from.
 function recentPayloads(category='light',windowDays=30){
  const cutoff=new Date(Date.now()-windowDays*86400000).toISOString()
  return db.prepare('SELECT payload,last_seen_at FROM listings WHERE category=? AND last_seen_at>=?').all(category,cutoff)
   .map(row=>{try{return{...JSON.parse(row.payload||'{}'),lastSeenAt:row.last_seen_at}}catch{return null}})
   .filter(Boolean)
 }
 return{db,storeListings,storeCrawl,detailCache,knownTokens,enabledAlerts,alertAlreadySent,recordAlertDelivery,pendingAlertDeliveries,markAlertDelivered,alertHistory,notifications,unreadNotifications,markNotificationsRead,saveListing,unsaveListing,savedListings,savedTokens,analyticsSeries,recordSellerStats,sellerReputation,worstSellers,snapshotBaseline,baselineTrend,pruneBaselineHistory,replaceReferencePrices,referencePrices,referenceMeta,upsertManualReference,deleteManualReference,manualReferences,logReferenceRun,referenceRuns,replaceBaseline,baselineRows,baselineLookup,baselineMeta,recentPayloads,verificationCandidates,markListingVerification,publicStats,plans,savePlan,dealerInventory,saveDealerInventory,deleteDealerInventory,dealerLeads,saveDealerLead,deleteDealerLead,integrations,saveIntegration,deleteIntegration,activeIntegrations,slides,saveSlide,deleteSlide,audit,audits,requestOtp,verifyOtp,userFromToken,createAdminSession,listPayloads,listingsSignature,
 logout:t=>db.prepare('DELETE FROM sessions WHERE token_hash=?').run(hash(t||'')),
 updateUser:(id,data)=>{db.prepare('UPDATE users SET name=?,city=? WHERE id=?').run(data.name,data.city,id);return db.prepare('SELECT * FROM users WHERE id=?').get(id)},
 listHistory:token=>db.prepare('SELECT price,recorded_at FROM price_history WHERE token=? ORDER BY recorded_at').all(token),
 stats:()=>({listings:db.prepare('SELECT COUNT(*) n FROM listings').get().n,activeListings:db.prepare("SELECT COUNT(*) n FROM listings WHERE status='active'").get().n,staleListings:db.prepare("SELECT COUNT(*) n FROM listings WHERE status='stale'").get().n,inactiveListings:db.prepare("SELECT COUNT(*) n FROM listings WHERE status='inactive'").get().n,removedListings:db.prepare("SELECT COUNT(*) n FROM listings WHERE status='removed'").get().n,users:db.prepare('SELECT COUNT(*) n FROM users').get().n,alerts:db.prepare('SELECT COUNT(*) n FROM alerts WHERE enabled=1').get().n,subscriptions:db.prepare("SELECT COUNT(*) n FROM subscriptions WHERE status='active'").get().n,tickets:db.prepare("SELECT COUNT(*) n FROM tickets WHERE status='open'").get().n,paymentGateways:db.prepare("SELECT COUNT(*) n FROM service_integrations WHERE kind='payment' AND enabled=1").get().n,smsProviders:db.prepare("SELECT COUNT(*) n FROM service_integrations WHERE kind='sms' AND enabled=1").get().n,activeSlides:db.prepare('SELECT COUNT(*) n FROM site_slides WHERE enabled=1').get().n,analyzedToday:db.prepare('SELECT COUNT(*) n FROM listing_observations WHERE observed_date=?').get(tehranDate()).n,goldenOpportunities:db.prepare("SELECT COUNT(*) n FROM listings WHERE status='active' AND score>=85").get().n}),
 createAlert:(uid,b)=>db.prepare('INSERT INTO alerts(user_id,title,filters,created_at) VALUES(?,?,?,?)').run(uid,b.title,json(b.filters),now()),alerts:uid=>db.prepare('SELECT * FROM alerts WHERE user_id=? ORDER BY id DESC').all(uid),toggleAlert:(uid,id,en)=>db.prepare('UPDATE alerts SET enabled=? WHERE id=? AND user_id=?').run(en?1:0,id,uid),
 deleteAlert:(uid,id)=>db.prepare('DELETE FROM alerts WHERE id=? AND user_id=?').run(id,uid).changes>0,
 countAlerts:uid=>db.prepare('SELECT COUNT(*) n FROM alerts WHERE user_id=?').get(uid).n,
 createTicket:(uid,b)=>db.prepare('INSERT INTO tickets(user_id,subject,message,created_at) VALUES(?,?,?,?)').run(uid,b.subject,b.message,now()),
 subscribe:(uid,plan,amount)=>{const start=new Date(),end=new Date(Date.now()+30*86400000);db.prepare("UPDATE subscriptions SET status='expired' WHERE user_id=? AND status='active'").run(uid);db.prepare('INSERT INTO subscriptions(user_id,plan,status,amount,started_at,expires_at,created_at) VALUES(?,?,?,?,?,?,?)').run(uid,plan,'active',amount,start.toISOString(),end.toISOString(),now());return{plan,status:'active',expiresAt:end.toISOString()}},subscription:uid=>db.prepare("SELECT * FROM subscriptions WHERE user_id=? ORDER BY id DESC LIMIT 1").get(uid),
 adminUsers:({query='',role='',limit=50,offset=0}={})=>{
  const where=[],params=[]
  if(query){where.push('(u.phone LIKE ? OR u.name LIKE ?)');params.push(`%${query}%`,`%${query}%`)}
  if(role==='admin'||role==='user'){where.push('u.role=?');params.push(role)}
  const clause=where.length?`WHERE ${where.join(' AND ')}`:''
  const total=db.prepare(`SELECT COUNT(*) n FROM users u ${clause}`).get(...params).n
  const items=db.prepare(`SELECT u.id,u.phone,u.name,u.city,u.role,u.created_at,(SELECT plan FROM subscriptions s WHERE s.user_id=u.id AND s.status='active' ORDER BY id DESC LIMIT 1) plan FROM users u ${clause} ORDER BY u.id DESC LIMIT ? OFFSET ?`).all(...params,Math.min(200,Math.max(1,limit)),Math.max(0,offset))
  return{items,total}
 },
 adminSubscriptions:()=>db.prepare('SELECT s.*,u.phone,u.name FROM subscriptions s JOIN users u ON u.id=s.user_id ORDER BY s.id DESC LIMIT 200').all(),
 adminTickets:()=>db.prepare('SELECT t.*,u.phone,u.name FROM tickets t LEFT JOIN users u ON u.id=t.user_id ORDER BY t.id DESC LIMIT 200').all(),
 adminListings:()=>db.prepare('SELECT token,title,city,price,score,category,crawl_scope,status,missing_count,first_seen_at,last_seen_at,last_verified_at,inactive_at,removed_at FROM listings ORDER BY last_seen_at DESC LIMIT 200').all(),
 setUserRole:(id,role)=>db.prepare('UPDATE users SET role=? WHERE id=?').run(role,id),
 setTicketStatus:(id,status)=>db.prepare('UPDATE tickets SET status=? WHERE id=?').run(status,id),
 setSubscriptionStatus:(id,status)=>db.prepare('UPDATE subscriptions SET status=? WHERE id=?').run(status,id),
 setListingStatus:(token,status)=>db.prepare("UPDATE listings SET status=?,inactive_at=CASE WHEN ?='inactive' THEN COALESCE(inactive_at,?) ELSE inactive_at END,removed_at=CASE WHEN ?='removed' THEN COALESCE(removed_at,?) ELSE removed_at END WHERE token=?").run(status,status,now(),status,now(),token),
 settings:()=>Object.fromEntries(db.prepare('SELECT key,value FROM settings').all().map(x=>[x.key,x.value])),
 updateSettings:values=>{const q=db.prepare('INSERT INTO settings(key,value,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at');for(const[key,value]of Object.entries(values))if(Object.hasOwn(defaults,key))q.run(key,String(value).slice(0,10000),now());return Object.fromEntries(db.prepare('SELECT key,value FROM settings').all().map(x=>[x.key,x.value]))}
}}
