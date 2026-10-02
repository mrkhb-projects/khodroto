import {beforeEach,describe,expect,it,vi} from 'vitest'
import {clearCompared,comparedCars,isCompared,toggleCompared} from '../src/comparison.js'

beforeEach(()=>{const values=new Map();global.localStorage={getItem:key=>values.has(key)?values.get(key):null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)};global.window={dispatchEvent:vi.fn()};clearCompared()})

describe('vehicle comparison selection',()=>{
 it('adds, toggles and persists selected vehicles',()=>{toggleCompared({id:'a',title:'A'});toggleCompared({id:'b',title:'B'});expect(comparedCars().map(car=>car.id)).toEqual(['a','b']);expect(isCompared('a')).toBe(true);toggleCompared({id:'a'});expect(isCompared('a')).toBe(false)})
 it('enforces the four-vehicle comparison limit',()=>{for(const id of ['1','2','3','4'])toggleCompared({id});const result=toggleCompared({id:'5'});expect(result.full).toBe(true);expect(comparedCars()).toHaveLength(4)})
 it('recovers safely from corrupt browser storage',()=>{localStorage.setItem('khodroto:compare','not-json');expect(comparedCars()).toEqual([])})
})
