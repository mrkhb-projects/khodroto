const clamp=(n,min,max)=>Math.min(max,Math.max(min,n))
export const median=values=>{const a=values.filter(Number.isFinite).sort((x,y)=>x-y);if(!a.length)return 0;const m=Math.floor(a.length/2);return a.length%2?a[m]:(a[m-1]+a[m])/2}
const mean=values=>{const a=values.filter(Number.isFinite);return a.length?a.reduce((s,v)=>s+v,0)/a.length:0}
const normalizeDigits=value=>String(value||'').replace(/[۰-۹]/g,d=>'۰۱۲۳۴۵۶۷۸۹'.indexOf(d))
const faNormalizeText=value=>normalizeDigits(value).replace(/ي/g,'ی').replace(/ك/g,'ک').replace(/‌/g,' ').toLowerCase()

// Brand→models catalogue (same source the admin panel edits in settings.vehicle_models).
// The model of each listing is matched against this lexicon first, so cohorts are real
// market identities ("دنا پلاس") instead of fuzzy title prefixes.
export const DEFAULT_MODEL_LINES='ایران خودرو | پژو ۲۰۶,پژو ۲۰۷,پژو پارس,پارس,دنا پلاس,دنا,تارا,رانا,سمند,سورن,هایما S5,هایما S7,هایما 8S\nسایپا | پراید,تیبا,ساینا,کوییک,شاهین,اطلس,وان\nمدیران خودرو | ام وی ام ۳۱۵,ام وی ام X22,ام وی ام X33,آریزو ۵,آریزو ۶,تیگو ۵,تیگو ۷,تیگو ۸\nکرمان موتور | جک J4,جک J5,جک S3,جک S5,KMC K7,KMC T8,KMC J7\nبهمن موتور | مزدا ۳,فیدلیتی,دیگنیتی,ریسپکت,کاپرا\nرنو | ال ۹۰,ساندرو,استپ وی,مگان,کولیوس,تلیسمان\nتویوتا | کرولا,کمری,لندکروز,پرادو,راوفور,هایلوکس\nهیوندای | اکسنت,النترا,سوناتا,آزرا,توسان,سانتافه,ایونیک,تلارا\nکیا | اپتیما,سراتو,اسپورتیج,سورنتو,ریو,کراس,کاردنزا\nسایر | فونیکس,لاماری,چری,جک,لیفان,بسترن,دانگ فنگ,چانگان,جیلی,اکودا,کاپی,میتسوبیشی,سوزوکی,نیسان,بی ام و,مرسدس بنز,لکسوس,ولوو,پورشه,فولکس واگن,اشکودا'

const TITLE_STOP=new Set(['صفر','کارکرد','آپشن','فول','فروش','فوری','تمیز','سالم','ویژه','اقساطی','نقدی','خودرو','ماشین','بدون','با','اتوماتیک','اتومات','دنده','دنده‌ای','گاز','گازی','بنزین','دو','گانه','سوز','دوگانه','هیبرید','رنگ','صندوق','دار','مدل','توربو','پلاس'])
const SHORT_WORD=new Set(['s','x','r','g','gt','lx','v','v4','ie','h','j'])

export function buildModelLexicon(lines=DEFAULT_MODEL_LINES){
 const lexicon=[]
 for(const line of String(lines||'').split('\n')){
  const parts=line.split('|')
  const models=(parts.length>1?parts[1]:parts[0]).split(',')
  for(const rawModel of models){
   const display=String(rawModel||'').trim()
   const normalized=faNormalizeText(display).replace(/[^\p{L}\d\s]/gu,' ').replace(/\s+/g,' ').trim()
   if(normalized.length<2||TITLE_STOP.has(normalized))continue
   lexicon.push({key:normalized,display})
  }
 }
 // Longest match wins: «دنا پلاس» before «دنا», «پژو ۲۰۷» before «پژو پارس».
 lexicon.sort((a,b)=>b.key.length-a.key.length)
 return lexicon
}
const DEFAULT_LEXICON=buildModelLexicon()

// Identify the vehicle model of a listing. Catalogue match first; otherwise use the
// first two meaningful title tokens (works for motorcycles/heavy/commercial too).
export function modelKeyFromTitle(title='',lexicon=DEFAULT_LEXICON){
 const normalized=faNormalizeText(title).replace(/[^\p{L}\d\s]/gu,' ').replace(/\s+/g,' ').trim()
 for(const entry of lexicon)if(` ${normalized} `.includes(` ${entry.key} `))return entry.display
 const tokens=normalized.split(' ').filter(token=>token&&!TITLE_STOP.has(token)&&!/^\d{2,4}$/.test(token)&&!SHORT_WORD.has(token))
 return tokens.slice(0,2).join(' ')||normalized.split(' ')[0]||'نامشخص'
}

// Group colors into broad market colors: «سفید صدفی» and «سفید» compare together.
function baseColor(color=''){
 const normalized=faNormalizeText(color).trim()
 if(!normalized||normalized==='—'||normalized==='نامشخص')return ''
 return normalized.split(' ')[0]
}

export function cohortKey(item){return modelKeyFromTitle(item.title)}
const ageHours=text=>{const s=normalizeDigits(text||'');if(s.includes('لحظ')||s.includes('دقایق'))return 0.2;const n=Number((s.match(/\d+/)||[1])[0]);if(s.includes('ساعت'))return n;if(s.includes('روز'))return n*24;if(s.includes('هفته'))return n*168;return 48}
function rules(category){if(category==='motorcycles')return{cheap:50,expensive:75,maxKm:350000};if(category==='heavy')return{cheap:45,expensive:70,maxKm:3000000};return{cheap:45,expensive:60,maxKm:1000000}}

// Build the market picture of a listing set: for every model, one price list per
// (year, color), per year and for the model overall. Prices with no year or no model
// are still usable at the broader levels, like a national cohort.
function buildCohorts(items,lexicon){
 const models=new Map()
 const bucket=(map,key)=>{if(!map.has(key))map.set(key,[]);return map.get(key)}
 for(const item of items){
  const price=Number(item.price)||0;if(!price)continue
  const model=modelKeyFromTitle(item.title,lexicon)
  const year=Number(item.year)||0
  const color=baseColor(item.color)
  if(!models.has(model))models.set(model,{key:model,prices:[],years:new Map()})
  const entry=models.get(model)
  entry.prices.push({price,color,year})
  if(year){
   if(!entry.years.has(year))entry.years.set(year,{year,prices:[],colors:new Map()})
   const y=entry.years.get(year)
   y.prices.push(price)
   if(color)bucket(y.colors,color).push(price)
  }
 }
 return models
}

const LEVEL_LABELS={color:'همان مدل، سال و رنگ',year:'همان مدل و سال',model:'همان مدل',none:'بدون نمونه کافی'}

// Drop prices that do not belong to this cohort at all (typos, swaps, scams) so one
// «پراید یک‌ونیم میلیاردی» never inflates the average of the real پراید market.
function trimOutliers(prices){
 if(prices.length<5)return prices
 const middle=median(prices)
 if(!middle)return prices
 const kept=prices.filter(price=>price>=middle*0.45&&price<=middle*1.6)
 return kept.length>=3?kept:prices
}
export function bestCohortFor(entry,item){
 if(!entry)return{level:'none',prices:[]}
 const color=baseColor(item.color),year=Number(item.year)||0
 if(year&&color){const y=entry.years.get(year),prices=y?.colors.get(color);if(prices&&prices.length>=3)return{level:'color',prices:trimOutliers(prices)}}
 if(year){const y=entry.years.get(year);if(y&&y.prices.length>=3)return{level:'year',prices:trimOutliers(y.prices)}}
 if(entry.prices.length>=5)return{level:'model',prices:trimOutliers(entry.prices.map(x=>x.price))}
 return{level:'none',prices:[]}
}

export function analyzeListings(items,{category='light',includeNoPhoto=false,modelLexicon}={}){
 const lexicon=modelLexicon?buildModelLexicon(modelLexicon):DEFAULT_LEXICON
 const valid=items.filter(x=>Number(x.price)>0&&(includeNoPhoto||Boolean(x.image)))
 const excluded=items.length-valid.length,cohorts=buildCohorts(valid,lexicon),cfg=rules(category)
 const analyzed=valid.map(item=>{
  const model=modelKeyFromTitle(item.title,lexicon)
  const {level,prices:comparables}=bestCohortFor(cohorts.get(model),item)
  const hasMarket=comparables.length>0,market=hasMarket?Math.round(median(comparables)):0
  const discount=hasMarket?((market-item.price)/market)*100:0
  const deviations=comparables.map(x=>Math.abs(x-market)),mad=median(deviations),robustZ=(hasMarket&&mad)?0.6745*(item.price-market)/mad:0
  const riskFlags=[]
  if(hasMarket&&discount>=cfg.cheap)riskFlags.push(`قیمت به‌طور غیرعادی پایین‌تر از میانگین ${LEVEL_LABELS[level]} است`)
  if(hasMarket&&discount<=-cfg.expensive)riskFlags.push(`قیمت به‌طور غیرعادی بالاتر از میانگین ${LEVEL_LABELS[level]} است`)
  if(hasMarket&&comparables.length>=7&&Math.abs(robustZ)>=3.5)riskFlags.push('قیمت خارج از الگوی آماری نمونه‌های مشابه است')
  if(/پیش.?پرداخت|قسط|اقساط|تحویل حواله|بیعانه/.test(item.title||''))riskFlags.push('ممکن است مبلغ درج‌شده قیمت کامل خودرو نباشد')
  if(item.year>1407||item.year&&item.year<1360)riskFlags.push('سال ساخت نیاز به بررسی دارد')
  if(item.km>cfg.maxKm)riskFlags.push('کارکرد ثبت‌شده غیرعادی است')
  if(!item.image&&!includeNoPhoto)riskFlags.push('آگهی تصویر ندارد')
  const completeness=[item.image,item.title,item.city,item.year,item.km,item.color&&item.color!=='—'].filter(Boolean).length/6,freshness=Math.max(0,1-ageHours(item.freshness)/168)
  // Confidence mainly reflects how comparably priced THIS model/year/color is — a
  // listing compared with its exact cohort is far more trustworthy than a global guess.
  const sampleConfidence=hasMarket?clamp(comparables.length/14,.25,1)*({color:1,year:.92,model:.8}[level]):0
  const confidence=hasMarket?Math.round((sampleConfidence*.55+completeness*.3+freshness*.15)*100):Math.round(clamp(completeness*.4+freshness*.1,0,.45)*100)
  let score=hasMarket?clamp(55+discount*1.25,0,100):54
  score=score*(.72+.28*sampleConfidence);score+=completeness*5+freshness*3
  if(riskFlags.length)score=Math.min(score,32-riskFlags.length*3)
  score=Math.round(clamp(score,0,100))
  const label=riskFlags.length?'مشکوک؛ نیازمند بررسی':!hasMarket?'داده بازار کافی نیست':score>=80?'فرصت عالی':score>=65?'زیر قیمت بازار':score>=45?'قیمت منصفانه':score>=25?'گران‌تر از بازار':'بسیار گران'
  return{...item,model,market,marketLevel:hasMarket?level:'none',marketLevelLabel:hasMarket?LEVEL_LABELS[level]:'',marketSamples:comparables.length,discount:Number(discount.toFixed(1)),score,confidence,sampleSize:comparables.length,suspicious:riskFlags.length>0,riskFlags,label,robustZ:Number(robustZ.toFixed(2))}
 }).sort((a,b)=>a.suspicious-b.suspicious||b.score-a.score)
 return{items:analyzed,excludedNoPhoto:excluded,suspiciousCount:analyzed.filter(x=>x.suspicious).length}
}

// Market intelligence: average and median price of every model (per build year and per
// color) aggregated from the live market data — the platform's pricing knowledge base.
export function summarizeMarket(items,{modelLexicon,minSamples=4}={}){
 const lexicon=modelLexicon?buildModelLexicon(modelLexicon):DEFAULT_LEXICON
 const priced=items.filter(item=>Number(item.price)>0)
 const cohorts=buildCohorts(priced,lexicon)
 const summarize=prices=>{const kept=trimOutliers(prices);return{samples:kept.length,median:Math.round(median(kept)),avg:Math.round(mean(kept)),min:Math.min(...kept),max:Math.max(...kept)}}
 const models=[]
 for(const [key,entry] of cohorts){
  if(entry.prices.length<minSamples)continue
  const byYear=[...entry.years.values()].filter(y=>y.prices.length>=3).map(y=>({year:y.year,...summarize(y.prices),byColor:[...y.colors.entries()].filter(([,prices])=>prices.length>=2).map(([color,prices])=>({color,...summarize(prices)})).sort((a,b)=>b.samples-a.samples)})).sort((a,b)=>b.samples-a.samples)
  models.push({model:key,...summarize(entry.prices.map(x=>x.price)),byYear})
 }
 models.sort((a,b)=>b.samples-a.samples)
 return{models,totalModels:models.length,totalListings:priced.length}
}
export const scoreColor=score=>`hsl(${Math.round(clamp(score,0,100)*1.25)}, ${score>55?58:72}%, ${score>55?38:48}%)`

// Filter analyzed listing payloads (live crawl or SQLite cache) with the public search filters.
// Fields that are not available in stored payloads (gearbox/body/seller) are only applied
// by the live Divar provider; here they are intentionally ignored instead of dropping results.
export function filterListingItems(items,filters={}){
 const queryTerms=faNormalizeText(filters.queryText||'').split(/\s+/).filter(Boolean)
 const cityNames=Array.isArray(filters.cityNames)?filters.cityNames.map(faNormalizeText).filter(Boolean):[]
 const minPrice=Number(filters.minPrice)||0,maxPrice=Number(filters.maxPrice)||0
 const minYear=Number(filters.minYear)||0,maxYear=Number(filters.maxYear)||0
 const maxUsage=Number(filters.maxUsage)||0
 const color=filters.color?faNormalizeText(filters.color):''
 const result=items.filter(item=>{
  if(!item||!item.id)return false
  if(cityNames.length){const city=faNormalizeText(item.city);if(!cityNames.some(name=>city.includes(name)))return false}
  if(queryTerms.length){const title=faNormalizeText(item.title);if(!queryTerms.every(term=>title.includes(term)))return false}
  const price=Number(item.price)||0
  if((minPrice||maxPrice)&&!price)return false
  if(minPrice&&price<minPrice)return false
  if(maxPrice&&price>maxPrice)return false
  if(minYear&&(!item.year||item.year<minYear))return false
  if(maxYear&&(!item.year||item.year>maxYear))return false
  if(maxUsage&&(!item.km||item.km>maxUsage))return false
  if(color&&faNormalizeText(item.color)!==color)return false
  return true
 })
 const byPrice=(a,b)=>{const pa=Number(a.price)||0,pb=Number(b.price)||0;if(!pa&&!pb)return 0;if(!pa)return 1;if(!pb)return -1;return pa-pb}
 const sort=String(filters.sort||'score')
 if(sort==='newest')result.sort((a,b)=>String(b.lastSeenAt||b.updatedAt||'').localeCompare(String(a.lastSeenAt||a.updatedAt||'')))
 else if(sort==='cheap')result.sort(byPrice)
 else if(sort==='expensive')result.sort((a,b)=>byPrice(b,a))
 else result.sort((a,b)=>(Number(b.score)||0)-(Number(a.score)||0))
 return result
}
