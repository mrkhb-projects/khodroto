import express from 'express'
import { createServer as createViteServer } from 'vite'
import { fallbackCars } from './src/data.js'

const app = express()
const PORT = process.env.PORT || 5173

function text(widget, title){
  if(!widget) return ''
  if(widget.data?.title===title) return widget.data?.value || ''
  return ''
}
function parsePersianNumber(value=''){
  const normalized=value.replace(/[۰-۹]/g,d=>'۰۱۲۳۴۵۶۷۸۹'.indexOf(d)).replace(/[٬,]/g,'')
  return Number((normalized.match(/\d+/)||[''])[0]) || 0
}
function normalizeDivar(payload){
  const posts = payload?.web_widgets?.post_list || []
  return posts.map((p,i)=>{
    const d=p.data||{}, title=d.title||'خودرو', priceText=d.bottom_description||''
    const price=parsePersianNumber(priceText)
    return {id:d.token||`divar-${i}`,title,year:1400,km:0,color:'—',city:d.top_description||'دیوار',price,market:price?Math.round(price*1.08):0,score:72,discount:7.4,freshness:'تازه',image:d.image_url?.[0]?.src,link:d.token?`https://divar.ir/v/${d.token}`:'https://divar.ir/s/tehran/car'}
  }).filter(x=>x.price>0)
}
app.get('/api/listings', async (_req,res)=>{
  const controller=new AbortController(); const timeout=setTimeout(()=>controller.abort(),5000)
  try{
    const response=await fetch('https://api.divar.ir/v8/web-search/tehran/car',{method:'POST',headers:{'content-type':'application/json','user-agent':'Mozilla/5.0'},body:JSON.stringify({page:1}),signal:controller.signal})
    if(!response.ok) throw new Error('upstream')
    const items=normalizeDivar(await response.json())
    if(!items.length) throw new Error('empty')
    res.json({source:'divar',items:items.slice(0,6),updatedAt:new Date().toISOString()})
  }catch{res.json({source:'demo',items:fallbackCars,notice:'اتصال مستقیم در محیط پیش‌نمایش در دسترس نیست.'})}
  finally{clearTimeout(timeout)}
})
const vite=await createViteServer({server:{middlewareMode:true,allowedHosts:true},appType:'spa'})
app.use(vite.middlewares)
app.listen(PORT,'0.0.0.0',()=>console.log(`Khodroto running on http://0.0.0.0:${PORT}`))
