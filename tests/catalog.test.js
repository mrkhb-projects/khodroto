import {describe,expect,it} from 'vitest'
import {divarCities,vehicleCategories,publicVehicleCatalog} from '../src/server/catalog.js'

describe('Divar automotive catalog',()=>{
 it('covers every harvested Iranian Divar city without duplicate ids',()=>{expect(divarCities.length).toBeGreaterThanOrEqual(370);expect(new Set(divarCities.map(city=>city.id)).size).toBe(divarCities.length);expect(divarCities).toContainEqual({id:'1',name:'تهران'});expect(divarCities).toContainEqual({id:'5',name:'تبریز'})})
 it('contains sales, motorcycle, parts, heavy and service categories',()=>{const slugs=vehicleCategories.map(category=>category.slug);expect(slugs).toEqual(expect.arrayContaining(['light','heavy','motorcycles','parts-accessories','vehicles-services']))})
 it('projects managed brands and models into the public catalog',()=>{const catalog=publicVehicleCatalog({vehicle_brands:'ایران خودرو\nسایپا',vehicle_models:'ایران خودرو | تارا,دنا\nسایپا | شاهین'});expect(catalog.brands).toEqual(['ایران خودرو','سایپا']);expect(catalog.models[0]).toEqual({brand:'ایران خودرو',models:['تارا','دنا']})})
})
