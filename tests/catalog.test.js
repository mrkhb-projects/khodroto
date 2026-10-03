import {describe,expect,it} from 'vitest'
import {divarCities,cityGroups,provinceList,vehicleCategories,publicVehicleCatalog} from '../src/server/catalog.js'

describe('Divar automotive catalog',()=>{
 it('offers a deduplicated city list with no repeated names and no «کل ایران» rows',()=>{
  const names=divarCities.map(city=>city.name)
  expect(new Set(divarCities.map(city=>city.id)).size).toBe(divarCities.length)
  expect(new Set(names).size).toBe(names.length)
  expect(names).not.toContain('کل ایران')
  expect(divarCities.find(city=>city.name==='تهران')).toMatchObject({id:'1',province:'تهران'})
  expect(divarCities.find(city=>city.name==='تبریز')).toMatchObject({id:'5',province:'آذربایجان شرقی'})
 })
 it('excludes Tehran/Ahvaz/Isfahan neighbourhoods that polluted the old picker',()=>{
  const names=divarCities.map(city=>city.name)
  for(const district of ['نیاوران','ولنجک','زعفرانیه','پونک','نارمک','کیانپارس','امانیه','جلفا','خواجو','ملک‌شهر'])
   expect(names).not.toContain(district)
 })
 it('groups cities under all 31 provinces so selection is province-first',()=>{
  expect(provinceList).toHaveLength(31)
  expect(cityGroups).toHaveLength(31)
  expect(cityGroups.every(group=>group.cities.length>0)).toBe(true)
  const tehran=cityGroups.find(group=>group.province==='تهران')
  expect(tehran.cities.map(city=>city.name)).toContain('تهران')
  const khuzestan=cityGroups.find(group=>group.province==='خوزستان')
  expect(khuzestan.cities.map(city=>city.name)).toEqual(expect.arrayContaining(['اهواز','آبادان','دزفول']))
 })
 it('contains sales, motorcycle, parts, heavy and service categories',()=>{const slugs=vehicleCategories.map(category=>category.slug);expect(slugs).toEqual(expect.arrayContaining(['light','heavy','motorcycles','parts-accessories','vehicles-services']))})
 it('projects managed brands and models into the public catalog',()=>{const catalog=publicVehicleCatalog({vehicle_brands:'ایران خودرو\nسایپا',vehicle_models:'ایران خودرو | تارا,دنا\nسایپا | شاهین'});expect(catalog.brands).toEqual(['ایران خودرو','سایپا']);expect(catalog.models[0]).toEqual({brand:'ایران خودرو',models:['تارا','دنا']})})
})

import {nearestCity,resolveCity,cityFromDivarLabel,provinces,citiesOf} from '../src/server/locations.js'

describe('location directory and geolocation',()=>{
 it('snaps a browser position to the nearest supported city',()=>{
  expect(nearestCity(35.7575,51.41)).toMatchObject({name:'تهران',province:'تهران'})
  expect(nearestCity(31.32,48.67)).toMatchObject({name:'اهواز',province:'خوزستان'})
 })
 it('returns nothing when the user is outside Iran instead of defaulting to Tehran',()=>{
  expect(nearestCity(42.69,23.32)).toBeNull()
  expect(nearestCity('x','y')).toBeNull()
 })
 it('reads the city out of a Divar «شهر، محله» label',()=>{
  expect(cityFromDivarLabel('تهران، پونک').name).toBe('تهران')
  expect(cityFromDivarLabel('اهواز، کیانپارس').name).toBe('اهواز')
 })
 it('resolves a city by id or by name',()=>{
  expect(resolveCity('1').name).toBe('تهران')
  expect(resolveCity('مشهد').id).toBe('3')
  expect(resolveCity('')).toBeNull()
 })
 it('lists cities for a province',()=>{
  const fars=provinces().find(province=>province.name==='فارس')
  expect(citiesOf(fars.id).map(city=>city.name)).toContain('شیراز')
 })
})
