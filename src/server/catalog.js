import fs from 'node:fs'

const readJson=name=>JSON.parse(fs.readFileSync(new URL(`./data/${name}`,import.meta.url),'utf8'))
const cityMap=readJson('divar-cities.json')
const extractedCategories=readJson('divar-vehicle-categories.json')

export const divarCities=Object.entries(cityMap).map(([id,name])=>({id,name})).sort((a,b)=>Number(a.id)-Number(b.id))
export const vehicleCategories=[
 ...extractedCategories.filter(item=>item.slug!=='vehicles'),
 {slug:'heavy',name:'خودرو سنگین و نیمه‌سنگین',parents:['وسایل نقلیه'],parent_slugs:['vehicles']},
 {slug:'vehicles-services',name:'خدمات خودرو و موتورسیکلت',parents:['خدمات'],parent_slugs:['services']},
].filter((item,index,items)=>items.findIndex(other=>other.slug===item.slug)===index)

export function publicVehicleCatalog(settings={}){
 const managedBrands=String(settings.vehicle_brands||'').split('\n').map(name=>name.trim()).filter(Boolean)
 const managedModels=String(settings.vehicle_models||'').split('\n').map(line=>{const[brand,...models]=line.split('|').map(value=>value.trim());return{brand,models:models.join('|').split(',').map(value=>value.trim()).filter(Boolean)}}).filter(item=>item.brand)
 return{source:'divar-taxonomy',updatedAt:settings.catalog_synced_at||null,cities:divarCities,categories:vehicleCategories,brands:managedBrands,models:managedModels}
}
