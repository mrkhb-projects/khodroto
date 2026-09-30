import {describe,expect,it} from 'vitest'
import {analyzeListings,scoreColor} from '../src/server/analyzer.js'
const car=(id,price,extra={})=>({id,title:'پژو 207 اتوماتیک',price,image:`${id}.jpg`,city:'تهران',freshness:'۱ ساعت پیش',year:1402,km:30000,color:'سفید',...extra})
describe('automotive analysis engine',()=>{
 it('excludes listings without photos by default',()=>{const r=analyzeListings([car('a',1000),car('b',900,{image:null})]);expect(r.items).toHaveLength(1);expect(r.excludedNoPhoto).toBe(1)})
 it('marks extreme low and high prices as suspicious',()=>{const items=[800,900,950,1000,1050,1100,1150,1200,200,2200].map((p,i)=>car(String(i),p));const r=analyzeListings(items);expect(r.items.find(x=>x.price===200).suspicious).toBe(true);expect(r.items.find(x=>x.price===2200).suspicious).toBe(true);expect(r.suspiciousCount).toBeGreaterThanOrEqual(2)})
 it('raises opportunity score for reasonably cheaper listings',()=>{const r=analyzeListings([car('a',800),car('b',900),car('c',1000),car('d',1100),car('e',1200)]);expect(r.items.find(x=>x.price===800).score).toBeGreaterThan(r.items.find(x=>x.price===1200).score)})
 it('uses red-to-green score colors',()=>{expect(scoreColor(10)).toContain('hsl(13');expect(scoreColor(90)).toContain('hsl(113')})
})
