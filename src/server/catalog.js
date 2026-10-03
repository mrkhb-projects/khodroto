import fs from 'node:fs'
import { allCities, groupedCities, provinces } from './locations.js'
import { catalogForCategory } from './vehicle-identity.js'

const readJson=name=>JSON.parse(fs.readFileSync(new URL(`./data/${name}`,import.meta.url),'utf8'))
const extractedCategories=readJson('divar-vehicle-categories.json')

// Curated province→city directory. The raw divar-cities.json scrape is NOT used for
// the picker any more: it repeated «کل ایران» 76 times and listed ~250 Tehran/Ahvaz
// neighbourhoods as if they were cities.
export const divarCities=allCities()
export const cityGroups=groupedCities()
export const provinceList=provinces()
// Brand/model trees per category, straight from the pricing taxonomy so that the
// filter options and the cohort keys can never drift apart.
export const segmentCatalog={light:catalogForCategory('light'),heavy:catalogForCategory('heavy'),motorcycles:catalogForCategory('motorcycles')}
export const vehicleCategories=[
 ...extractedCategories.filter(item=>item.slug!=='vehicles'),
 {slug:'heavy',name:'خودرو سنگین و نیمه‌سنگین',parents:['وسایل نقلیه'],parent_slugs:['vehicles']},
 {slug:'vehicles-services',name:'خدمات خودرو و موتورسیکلت',parents:['خدمات'],parent_slugs:['services']},
].filter((item,index,items)=>items.findIndex(other=>other.slug===item.slug)===index)

export function publicVehicleCatalog(settings={}){
 const managedBrands=String(settings.vehicle_brands||'').split('\n').map(name=>name.trim()).filter(Boolean)
 const managedModels=String(settings.vehicle_models||'').split('\n').map(line=>{const[brand,...models]=line.split('|').map(value=>value.trim());return{brand,models:models.join('|').split(',').map(value=>value.trim()).filter(Boolean)}}).filter(item=>item.brand)
 return{source:'divar-taxonomy',updatedAt:settings.catalog_synced_at||null,cities:divarCities,cityGroups,provinces:provinceList,segments:segmentCatalog,categories:vehicleCategories,brands:managedBrands,models:managedModels}
}
