// Cross-source duplicate detection.
//
// WHY
// The same car is routinely posted on Divar, Bama, Sheypoor and a dealer site at
// once. Before this, each copy counted as an independent data point, so a dealer
// with a wide posting footprint could triple-weight their own price in the market
// average — and the results page showed the user the same car three times.
//
// Matching is deliberately conservative: we only merge when the vehicle identity,
// the build year, the city and the price all line up. Two genuinely different cars
// of the same model/year/city almost never carry an identical price to the Rial.

import { identifyVehicle, normalizeYear, normalizeText } from './vehicle-identity.js'

// Trust order when the same car appears in several places: an inspected listing
// beats a classified, and a classified beats an auction placeholder.
const SOURCE_RANK = {
  'همراه مکانیک': 5,
  'خودرو ۴۵': 4,
  'باما': 3,
  'دیوار': 2,
  'شیپور': 2,
  'رینگ': 1,
}
const rankOf = item => SOURCE_RANK[item.source] ?? 2

const cityKey = city => normalizeText(String(city || '').split(/[،,]/)[0])

/**
 * Price bucket, in millions of Toman.
 * An identical asking price is by far the strongest duplicate signal: the same
 * dealer copies the same number onto every site. Rounding to the million absorbs
 * trivial formatting differences without merging genuinely different asks
 * (980م and 1,000م stay apart).
 */
const priceBucket = price => Math.round((Number(price) || 0) / 1_000_000)

export function duplicateKey(item, categoryHint = 'light') {
  const identity = item.identity || identifyVehicle(item.title, item.category || categoryHint)
  const year = normalizeYear(item.year) || 0
  // Mileage is deliberately NOT part of the key: one source usually knows it and
  // another does not, and including it meant the very copies we most want to merge
  // (so we can fill the gaps from each other) never matched.
  return [identity.key, year, cityKey(item.city), priceBucket(item.price)].join('|')
}

/**
 * Collapse duplicates.
 * Keeps the highest-trust copy and records the others on `alsoOn` so the UI can
 * show «این خودرو در ۳ سایت آگهی شده» instead of hiding information.
 */
export function dedupeListings(items, { categoryHint = 'light' } = {}) {
  const groups = new Map()
  for (const item of items || []) {
    const key = duplicateKey(item, categoryHint)
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(item)
  }

  const merged = []
  let removed = 0
  for (const group of groups.values()) {
    if (group.length === 1) { merged.push(group[0]); continue }
    const sorted = [...group].sort((a, b) => rankOf(b) - rankOf(a) || (b.image ? 1 : 0) - (a.image ? 1 : 0))
    const winner = sorted[0]
    const others = sorted.slice(1)
    removed += others.length
    merged.push({
      ...winner,
      // Fill gaps from the duplicates: one source may know the colour, another the km.
      color: winner.color && winner.color !== '—' ? winner.color : others.find(item => item.color && item.color !== '—')?.color || winner.color,
      km: Number(winner.km) > 0 ? winner.km : others.find(item => Number(item.km) > 0)?.km || 0,
      year: normalizeYear(winner.year) || others.map(item => normalizeYear(item.year)).find(Boolean) || 0,
      duplicateCount: group.length,
      alsoOn: [...new Set(others.map(item => item.source).filter(Boolean))],
    })
  }
  return { items: merged, stats: { input: items?.length || 0, output: merged.length, removed } }
}
