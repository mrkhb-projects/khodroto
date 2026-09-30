const clamp=(n,min,max)=>Math.min(max,Math.max(min,n))
export const median=values=>{const a=values.filter(Number.isFinite).sort((x,y)=>x-y);if(!a.length)return 0;const m=Math.floor(a.length/2);return a.length%2?a[m]:(a[m-1]+a[m])/2}
const normalizeDigits=value=>String(value||'').replace(/[۰-۹]/g,d=>'۰۱۲۳۴۵۶۷۸۹'.indexOf(d))
const STOP=new Set(['فروش','فوری','صفر','مدل','تمیز','سالم','ویژه','اقساطی','نقدی','خودرو','ماشین','بدون','با'])
export function cohortKey(item){const tokens=normalizeDigits(item.title).toLowerCase().replace(/[^\p{L}\d\s]/gu,' ').split(/\s+/).filter(x=>x&&!STOP.has(x));return tokens.slice(0,3).join(' ')}
const ageHours=text=>{const s=String(text||'');if(s.includes('لحظ')||s.includes('دقایق'))return 0.2;const n=Number((normalizeDigits(s).match(/\d+/)||[1])[0]);if(s.includes('ساعت'))return n;if(s.includes('روز'))return n*24;if(s.includes('هفته'))return n*168;return 48}
function rules(category){if(category==='motorcycles')return{cheap:50,expensive:75,maxKm:350000};if(category==='heavy')return{cheap:45,expensive:70,maxKm:3000000};return{cheap:45,expensive:60,maxKm:1000000}}
export function analyzeListings(items,{category='light',includeNoPhoto=false}={}){
 const valid=items.filter(x=>Number(x.price)>0&&(includeNoPhoto||Boolean(x.image)))
 const excluded=items.length-valid.length, groups=new Map();for(const item of valid){const key=cohortKey(item);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(item.price)}
 const allPrices=valid.map(x=>x.price),globalMedian=median(allPrices),cfg=rules(category)
 const analyzed=valid.map(item=>{const cohort=groups.get(cohortKey(item))||[],comparables=cohort.length>=4?cohort:allPrices,market=Math.round(median(comparables)),discount=market?((market-item.price)/market)*100:0,deviations=comparables.map(x=>Math.abs(x-market)),mad=median(deviations),robustZ=mad?0.6745*(item.price-market)/mad:0
  const riskFlags=[];if(discount>=cfg.cheap)riskFlags.push('قیمت به‌طور غیرعادی پایین‌تر از بازار است');if(discount<=-cfg.expensive)riskFlags.push('قیمت به‌طور غیرعادی بالاتر از بازار است');if(comparables.length>=7&&Math.abs(robustZ)>=3.5)riskFlags.push('قیمت خارج از الگوی آماری نمونه‌های مشابه است');if(/پیش.?پرداخت|قسط|اقساط|تحویل حواله|بیعانه/.test(item.title||''))riskFlags.push('ممکن است مبلغ درج‌شده قیمت کامل خودرو نباشد');if(item.year>1407||item.year&&item.year<1360)riskFlags.push('سال ساخت نیاز به بررسی دارد');if(item.km>cfg.maxKm)riskFlags.push('کارکرد ثبت‌شده غیرعادی است');if(!item.image&&!includeNoPhoto)riskFlags.push('آگهی تصویر ندارد')
  const completeness=[item.image,item.title,item.city,item.year,item.km,item.color&&item.color!=='—'].filter(Boolean).length/6,freshness=Math.max(0,1-ageHours(item.freshness)/168),sampleConfidence=clamp(comparables.length/20,.2,1),confidence=Math.round((sampleConfidence*.55+completeness*.3+freshness*.15)*100)
  let score=clamp(55+discount*1.25,0,100);score=score*(.72+.28*sampleConfidence);score+=completeness*5+freshness*3;if(riskFlags.length)score=Math.min(score,32-riskFlags.length*3);score=Math.round(clamp(score,0,100))
  const label=riskFlags.length?'مشکوک؛ نیازمند بررسی':score>=80?'فرصت عالی':score>=65?'زیر قیمت بازار':score>=45?'قیمت منصفانه':score>=25?'گران‌تر از بازار':'بسیار گران'
  return{...item,market,discount:Number(discount.toFixed(1)),score,confidence,sampleSize:comparables.length,suspicious:riskFlags.length>0,riskFlags,label,robustZ:Number(robustZ.toFixed(2))}
 }).sort((a,b)=>a.suspicious-b.suspicious||b.score-a.score)
 return{items:analyzed,excludedNoPhoto:excluded,suspiciousCount:analyzed.filter(x=>x.suspicious).length}
}
export const scoreColor=score=>`hsl(${Math.round(clamp(score,0,100)*1.25)}, ${score>55?58:72}%, ${score>55?38:48}%)`
