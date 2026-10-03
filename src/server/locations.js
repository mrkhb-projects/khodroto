// Location directory: province → city, plus reverse geocoding to the nearest city.
//
// WHY THIS EXISTS
// The old city selector was fed straight from a scraped Divar id→name map. That map
// contained «کل ایران» under 76 different ids and ~250 Tehran/Ahvaz/Isfahan NEIGHBOURHOODS
// (نیاوران، ولنجک، کیانپارس، جلفا …) mixed in with real cities, in scrape order. The
// dropdown was therefore unusable: ten identical entries, districts between cities,
// no grouping.
//
// Here the data is curated: 31 provinces, each with the cities we hold a valid Divar
// city id for. Districts are excluded by construction, every entry is unique, and the
// list is ordered (province alphabetically-by-importance, cities within a province).

import data from './data/iran-locations.json' with { type: 'json' }
import { normalizeText } from './vehicle-identity.js'

export const ALL_IRAN = { id: '', name: 'کل ایران' }

export const provinces = () => data.provinces.map(({ id, name, cities }) => ({ id, name, cityCount: cities.length }))

export const citiesOf = provinceId => {
  const province = data.provinces.find(p => p.id === provinceId)
  return province ? province.cities.map(({ id, name }) => ({ id, name, province: province.name })) : []
}

const flat = data.provinces.flatMap(province => province.cities.map(city => ({ ...city, provinceId: province.id, province: province.name })))

/** Every selectable city, deduplicated, each tagged with its province. */
export const allCities = () => flat.map(({ id, name, province, provinceId }) => ({ id, name, province, provinceId }))

/** Grouped shape the UI renders as <optgroup> — province heading, then its cities. */
export const groupedCities = () => data.provinces.map(province => ({
  province: province.name,
  provinceId: province.id,
  cities: province.cities.map(({ id, name }) => ({ id, name })),
}))

const byId = new Map(flat.map(city => [String(city.id), city]))
const byName = new Map(flat.map(city => [normalizeText(city.name), city]))

export function resolveCity(value) {
  if (value === null || value === undefined || value === '') return null
  const asId = byId.get(String(value))
  if (asId) return asId
  return byName.get(normalizeText(value)) || null
}

/**
 * Divar city names arrive as «تهران، پونک» — city first, then district. We only
 * ever match on the city part so a district never becomes its own "city".
 */
export function cityFromDivarLabel(label = '') {
  const head = String(label).split(/[،,]/)[0].trim()
  return resolveCity(head)
}

const toRad = deg => (deg * Math.PI) / 180
function haversineKm(aLat, aLng, bLat, bLng) {
  const R = 6371
  const dLat = toRad(bLat - aLat), dLng = toRad(bLng - aLng)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)))
}

/**
 * Nearest supported city to a browser geolocation fix.
 * `maxKm` guards against snapping someone in a country far away onto Tehran.
 */
export function nearestCity(lat, lng, { maxKm = 250 } = {}) {
  const latitude = Number(lat), longitude = Number(lng)
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null
  let best = null
  for (const city of flat) {
    const distanceKm = haversineKm(latitude, longitude, city.lat, city.lng)
    if (!best || distanceKm < best.distanceKm) best = { ...city, distanceKm: Number(distanceKm.toFixed(1)) }
  }
  if (!best || best.distanceKm > maxKm) return null
  return { id: best.id, name: best.name, province: best.province, provinceId: best.provinceId, distanceKm: best.distanceKm }
}

export const stats = () => ({ provinces: data.provinces.length, cities: flat.length })
