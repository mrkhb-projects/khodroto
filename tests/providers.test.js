import {describe,expect,it} from 'vitest'
import {parseBamaCards} from '../src/server/providers/bama.js'
import {toJalaliYear,relativeFreshness} from '../src/server/providers/common.js'

// Fixture mimics the real SSR card shape verified on bama.ir/car (2026-10-02).
const bamaFixture=`<div class="list">
<a class="list-item" href="/car/detail-abc1234-peugeot-206sd-v8-1398">
  <img src="https://cdn-sth1.bama.ir/uploads/BamaImages/x_thumb_900_600.jpg?x-img=v1" alt="پژو، 206 SD"/>
  <span class="photos">4</span>
  <h3>پژو، 206 SD</h3>
  <p>V8</p>
  <div class="detail"><span>1398.کارکرد 39,000 کیلومتر</span></div>
  <footer><span>دقایقی پیش</span><span>تهران، ولنجک</span><b>2,150,000,000تومان</b></footer>
</a>
<a class="list-item" href="/car/detail-def5678-kia-picanto-2016">
  <img data-src="https://cdn-sth1.bama.ir/uploads/BamaImages/y_thumb_900_600.jpg?x-img=v1" alt="کیا، پیکانتو"/>
  <h3>کیا، پیکانتو</h3>
  <p>اتوماتیک</p>
  <div class="detail"><span>۲۰۱۶.کارکرد 34,000 کیلومتر</span></div>
  <footer><span>لحظاتی پیش</span><span>اصفهان</span><b>3,800,000,000تومان</b></footer>
</a>
<a href="/promo/page"><span>بدون قیمت</span></a>
</div>`

describe('bama public card parser',()=>{
 it('extracts price, jalali year, usage, city and media from gyregorian/jalali cards',()=>{
  const items=parseBamaCards(bamaFixture)
  expect(items).toHaveLength(2)
  const first=items[0]
  expect(first.id).toBe('bama:abc1234');expect(first.source).toBe('باما')
  expect(first.title).toContain('206');expect(first.price).toBe(2150000000)
  expect(first.year).toBe(1398);expect(first.km).toBe(39000)
  expect(first.city).toContain('ولنجک');expect(first.link).toContain('bama.ir')
  expect(first.image).toContain('cdn-sth1.bama.ir')
 })
 it('converts gregorian model years to jalali',()=>{
  const second=parseBamaCards(bamaFixture)[1]
  expect(second.year).toBe(1395)
  expect(toJalaliYear(2024)).toBe(1403);expect(toJalaliYear(1398)).toBe(1398);expect(toJalaliYear(1800)).toBe(0)
 })
 it('skips cards without a price and never throws',()=>{
  expect(parseBamaCards('<a href="/car/detail-x"><span>تست</span></a>')).toHaveLength(0)
  expect(parseBamaCards('')).toHaveLength(0)
 })
 it('normalizes freshness phrases',()=>{
  expect(relativeFreshness('دقایقی پیش')).toBe('دقایقی پیش')
  expect(relativeFreshness('۳ ساعت پیش')).toBe('3 ساعت پیش')
  expect(relativeFreshness('هفته پیش')).toBe('1 هفته پیش')
 })
})
