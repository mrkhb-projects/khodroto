// Public analysis API for the platform.
//
// This file is now a thin orchestration layer. The real work lives in:
//   vehicle-identity.js → what vehicle IS this (segment/type/brand/model/year)
//   pricing.js          → rolling 30-day baseline per model/year/colour
//   opportunity.js      → strict rules deciding if a price is really a bargain
//
// Keeping the exported names stable means server.js, divar.js and the frontend
// continue to work unchanged.

import { identifyVehicle, normalizeText as faNormalizeText, normalizeYear, baseColor } from './vehicle-identity.js'
import { buildPriceIndex, valuate, summarizeIndex, exportBaseline, describe as describePrices, median as robustMedian, DEFAULT_WINDOW_DAYS, MIN_SAMPLES } from './pricing.js'
import { evaluateListing } from './opportunity.js'
import { screenListing } from './fraud.js'

export { buildPriceIndex, valuate, exportBaseline, DEFAULT_WINDOW_DAYS, MIN_SAMPLES }
export const median = robustMedian
const clamp = (n, min, max) => Math.min(max, Math.max(min, n))

/** Human-friendly model name for a listing title («پراید ۱۳۱», «مینی‌بوس بنز ۳۰۲»). */
export function modelKeyFromTitle(title = '', categoryHint = 'light') {
  return identifyVehicle(title, categoryHint).label
}
export function cohortKey(item, categoryHint = 'light') { return identifyVehicle(item.title, categoryHint).key }

/**
 * Score a set of listings against the market they themselves describe.
 * `windowDays` bounds the baseline to recent activity (default 30 days) so stale
 * crawls cannot define today's prices.
 */
export function analyzeListings(items, { category = 'light', includeNoPhoto = false, windowDays = DEFAULT_WINDOW_DAYS, now = Date.now(), priceIndex = null, reference = null } = {}) {
  const all = (items || []).map(item => ({ ...item, identity: item.identity || identifyVehicle(item.title, category), year: normalizeYear(item.year) || 0 }))
  const valid = all.filter(item => Number(item.price) > 0 && (includeNoPhoto || Boolean(item.image)))
  const excludedNoPhoto = items.length - valid.length
  // The baseline is always built from the photo-bearing, priced population, even
  // when the caller wants no-photo listings in the OUTPUT.
  const built = priceIndex || buildPriceIndex(valid.filter(item => includeNoPhoto ? true : Boolean(item.image)), { categoryHint: category, windowDays, now, reference })

  const analyzed = valid.map(item => {
    const valuation = valuate(item, built, { categoryHint: category })
    // Fraud screen result: reuse the verdict computed during the index build when
    // available, otherwise screen on the spot (e.g. a caller passed a prebuilt index).
    const screened = built.verdicts?.get(item.id ?? item.token)
      || screenListing(item, { reference, cohort: valuation })
    const verdict = evaluateListing(item, valuation, { now, screen: screened })
    return {
      ...item,
      model: item.identity.label,
      cohortKey: item.identity.key,
      segment: item.identity.segment,
      vehicleType: item.identity.type,
      brand: item.identity.brand,
      market: verdict.market,
      marketAvg: verdict.marketAvg,
      marketLevel: verdict.level,
      marketLevelLabel: verdict.levelLabel,
      marketSamples: verdict.samples,
      sampleSize: verdict.samples,
      discount: verdict.discount,
      deviation: verdict.deviation,
      score: verdict.score,
      grade: verdict.grade,
      confidence: verdict.confidence,
      eligible: verdict.eligible,
      suspicious: verdict.suspicious,
      riskFlags: verdict.riskFlags,
      gateCodes: verdict.gateCodes,
      label: verdict.label,
      reason: verdict.reason,
      robustZ: verdict.deviation,
      trust: screened.severity,
      trusted: screened.severity === 'ok',
      priceWarnings: screened.flags.map(flag => flag.text),
      priceWarningCodes: screened.flags.map(flag => flag.code),
      referencePrice: screened.reference?.price || 0,
      referenceYear: screened.reference?.year || 0,
      referenceRatio: screened.reference?.ratio || 0,
    }
  }).sort((a, b) => Number(a.suspicious) - Number(b.suspicious) || (b.score ?? -1) - (a.score ?? -1))

  return {
    items: analyzed,
    excludedNoPhoto,
    suspiciousCount: analyzed.filter(x => x.suspicious).length,
    opportunityCount: analyzed.filter(x => x.eligible && ['exceptional', 'strong'].includes(x.grade)).length,
    rejectedCount: analyzed.filter(x => x.trust === 'reject').length,
    reviewCount: analyzed.filter(x => x.trust === 'review').length,
    priceIndex: built,
    coverage: built.stats,
  }
}

/** Market knowledge base: average/median per model, build year and colour. */
export function summarizeMarket(items, { category = 'light', minSamples = MIN_SAMPLES.model, windowDays = DEFAULT_WINDOW_DAYS, now = Date.now() } = {}) {
  const built = buildPriceIndex(items || [], { categoryHint: category, windowDays, now })
  const summary = summarizeIndex(built, { minSamples })
  return { ...summary, totalListings: built.stats.considered }
}

export const scoreColor = score => `hsl(${Math.round(clamp(Number(score) || 0, 0, 100) * 1.25)}, ${score > 55 ? 58 : 72}%, ${score > 55 ? 38 : 48}%)`

// Filter analyzed listing payloads (live crawl or SQLite cache) with the public search filters.
export function filterListingItems(items,filters={}){
 const queryTerms=faNormalizeText(filters.queryText||'').split(/\s+/).filter(Boolean)
 const cityNames=Array.isArray(filters.cityNames)?filters.cityNames.map(faNormalizeText).filter(Boolean):[]
 const minPrice=Number(filters.minPrice)||0,maxPrice=Number(filters.maxPrice)||0
 const minYear=Number(filters.minYear)||0,maxYear=Number(filters.maxYear)||0
 const maxUsage=Number(filters.maxUsage)||0
 const color=filters.color?faNormalizeText(filters.color):''
 const result=items.filter(item=>{
  if(!item||!item.id)return false
  if(cityNames.length){const city=faNormalizeText(item.city);if(!cityNames.some(name=>city.includes(name)))return false}
  if(queryTerms.length){const title=faNormalizeText(item.title);if(!queryTerms.every(term=>title.includes(term)))return false}
  const price=Number(item.price)||0
  if((minPrice||maxPrice)&&!price)return false
  if(minPrice&&price<minPrice)return false
  if(maxPrice&&price>maxPrice)return false
  if(minYear&&(!item.year||item.year<minYear))return false
  if(maxYear&&(!item.year||item.year>maxYear))return false
  if(maxUsage&&(!item.km||item.km>maxUsage))return false
  if(color&&faNormalizeText(item.color)!==color)return false
  return true
 })
 const byPrice=(a,b)=>{const pa=Number(a.price)||0,pb=Number(b.price)||0;if(!pa&&!pb)return 0;if(!pa)return 1;if(!pb)return -1;return pa-pb}
 const sort=String(filters.sort||'score')
 if(sort==='newest')result.sort((a,b)=>String(b.lastSeenAt||b.updatedAt||'').localeCompare(String(a.lastSeenAt||a.updatedAt||'')))
 else if(sort==='cheap')result.sort(byPrice)
 else if(sort==='expensive')result.sort((a,b)=>byPrice(b,a))
 else result.sort((a,b)=>(Number(b.score)||0)-(Number(a.score)||0))
 return result
}
