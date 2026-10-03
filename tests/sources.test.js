import {describe,expect,it} from 'vitest'
import {parseRow,scrapeSource} from '../src/server/reference/generic.js'
import {identifyRow,buildReferenceIndex,sourceCatalogue} from '../src/server/reference/index.js'
import {providerCatalogue} from '../src/server/providers/index.js'
import {screenListing} from '../src/server/fraud.js'

const fixed=html=>async()=>html

describe('generic reference parser',()=>{
 it('reads a heavy-truck price table (paye1 shape)',async()=>{
  const html=`<h2>قیمت روز مان</h2><table>
   <tr><td>کشنده مان 18.470 TGX نیوفیس</td><td>مشاهده جزئیات</td><td>2021</td><td>1405/05/14</td><td>% 16.67+</td><td>14,000,000,000</td></tr>
   <tr><td>کشنده مان TGX 18.480</td><td>مشاهده جزئیات</td><td>2019</td><td>1405/05/14</td><td>% 0.24-</td><td>8,400,000,000</td></tr></table>`
  const result=await scrapeSource({key:'paye1',categoryHint:'heavy',kind:'used',mode:'table',url:'x',minPrice:300000000},{fetchImpl:fixed(html)})
  expect(result.rows).toHaveLength(2)
  expect(result.rows[0]).toMatchObject({year:2021,price:14000000000})
  expect(result.rows[1].price).toBe(8400000000)
 })

 it('does not glue a model number onto the price',()=>{
  // «HONDA CLICK ۱۶۰» + «1.323.000.000» must not become 1,601,323,000,000.
  const row='<tr><td>هوندا کلیک HONDA CLICK ۱۶۰</td><td>1.323.000.000</td></tr>'
  expect(parseRow(row,{minPrice:20000000}).price).toBe(1323000000)
 })

 it('ignores the percentage-change and update-date columns',()=>{
  const row='<tr><td>کشنده اسکانیا R 500</td><td>2020</td><td>1405/05/10</td><td>% 12.5+</td><td>23,100,000,000</td></tr>'
  const parsed=parseRow(row,{minPrice:300000000})
  expect(parsed.price).toBe(23100000000)
  expect(parsed.year).toBe(2020)
 })

 it('rejects malformed separator groups that are not real amounts',()=>{
  expect(parseRow('<tr><td>مدل</td><td>12.34.5678</td></tr>',{})).toBeNull()
 })

 it('dates a zero-km price board to the current model year',async()=>{
  const html='<table><tr><td>باجاج پالس ان اس ۲۰۰</td><td>1.000.000.000</td></tr></table>'
  const result=await scrapeSource({key:'moto',categoryHint:'motorcycles',kind:'new',mode:'table',url:'x',minPrice:20000000},{fetchImpl:fixed(html)})
  expect(result.rows[0].year).toBe(1405)
 })

 it('reports a redesign instead of silently returning nothing useful',async()=>{
  const result=await scrapeSource({key:'x',mode:'table',url:'x'},{fetchImpl:fixed('<html>nothing</html>')})
  expect(result.rows).toHaveLength(0)
  expect(result.note).toContain('SHAPE_CHANGED')
 })
})

describe('segment-aware reference identity',()=>{
 it('maps heavy rows into the heavy taxonomy, never passenger cars',()=>{
  const row=identifyRow({brand:'',model:'کشنده ولوو FH 500',year:2023,price:37500000000,categoryHint:'heavy',source:'otobantruck'})
  expect(row.segment).toBe('heavy')
  expect(row.cohortKey).toContain('کشنده')
  expect(row.cohortKey).not.toContain('سواری')
 })
 it('maps motorcycle rows into the motorcycle taxonomy',()=>{
  const row=identifyRow({brand:'',model:'باجاج پالس ان اس ۲۰۰',year:1405,price:1000000000,categoryHint:'motorcycles',source:'asbe'})
  expect(row.segment).toBe('motorcycle')
  expect(row.cohortKey).toContain('موتورسیکلت')
 })
 it('builds a usable index across all three segments',()=>{
  const rows=[
   identifyRow({model:'کشنده اسکانیا R 500',year:2020,price:23100000000,categoryHint:'heavy',source:'a'}),
   identifyRow({model:'هوندا PCX ۱۶۰',year:1405,price:1400000000,categoryHint:'motorcycles',source:'b'}),
   identifyRow({brand:'سایپا',model:'کوییک',year:1402,price:1030000000,categoryHint:'light',source:'c'}),
  ].filter(Boolean)
  const index=buildReferenceIndex(rows)
  expect(index.cohorts).toBe(3)
  expect(rows.map(row=>row.segment).sort()).toEqual(['heavy','light','motorcycle'])
 })
 it('screens a fake heavy-vehicle ad against the heavy reference',()=>{
  const reference=buildReferenceIndex([identifyRow({model:'کشنده اسکانیا R 500',year:2020,price:23100000000,categoryHint:'heavy',source:'a'})].filter(Boolean))
  const verdict=screenListing({id:'f',title:'کشنده اسکانیا R500 مدل 2020',price:5000000000,year:2020,image:'i.jpg',category:'heavy'},{reference})
  expect(verdict.severity).toBe('reject')
  expect(verdict.flags.map(f=>f.code)).toContain('BELOW_REFERENCE')
 })
})

describe('source catalogues',()=>{
 it('covers all three segments with reference sources',()=>{
  const segments=new Set(sourceCatalogue().map(source=>source.segment))
  expect([...segments].sort()).toEqual(['heavy','light','motorcycle'])
  expect(sourceCatalogue().length).toBeGreaterThanOrEqual(7)
 })
 it('lists every listing provider with its categories',()=>{
  const keys=providerCatalogue().map(provider=>provider.key)
  expect(keys).toEqual(expect.arrayContaining(['bama','sheypoor','ring','khodro45','hamrahmechanic']))
  expect(providerCatalogue().every(provider=>provider.enabled===false)).toBe(true)
 })
})
