import { bamaListings } from './bama.js'
import { sheypoorListings } from './sheypoor.js'
import { ringListings } from './ring.js'
import { khodro45Listings } from './khodro45.js'
import { hamrahMechanicListings } from './hamrahmechanic.js'

// Registry of every market source beyond Divar. All are OFF unless explicitly enabled
// with environment variables, so the proven Divar flow stays the default everywhere.
//   BAMA_ENABLED=true · SHEYPOOR_ENABLED=true · RING_ENABLED=true
//   KHODRO45_ENABLED=true · HAMRAH_LISTINGS_ENABLED=true
// Resolution order for a toggle: the admin panel's setting wins when it is set at
// all, then the environment variable, then off. Operators should not need SSH to
// turn a source on, but a host that pins a variable must still be able to.
let overrides = {}
export function setProviderOverrides(next = {}) { overrides = next || {} }
const flag = (key, env = process.env) => {
  const override = overrides[key]
  if (override === true || override === 'true') return true
  if (override === false || override === 'false') return false
  return env[key] === 'true'
}

const PROVIDERS = {
  bama: {
    name: 'باما',
    envKey: 'BAMA_ENABLED',
    enabled: () => flag('BAMA_ENABLED'),
    categories: ['light', 'motorcycles', 'heavy'],
    fetch: bamaListings,
  },
  sheypoor: {
    name: 'شیپور',
    envKey: 'SHEYPOOR_ENABLED',
    enabled: () => flag('SHEYPOOR_ENABLED'),
    categories: ['light', 'motorcycles'],
    fetch: sheypoorListings,
  },
  ring: {
    name: 'رینگ',
    envKey: 'RING_ENABLED',
    enabled: () => flag('RING_ENABLED'),
    categories: ['light'],
    fetch: ringListings,
  },
  khodro45: {
    name: 'خودرو ۴۵',
    envKey: 'KHODRO45_ENABLED',
    enabled: () => flag('KHODRO45_ENABLED'),
    categories: ['light', 'motorcycles'],
    fetch: khodro45Listings,
  },
  hamrahmechanic: {
    name: 'همراه مکانیک',
    envKey: 'HAMRAH_LISTINGS_ENABLED',
    enabled: () => flag('HAMRAH_LISTINGS_ENABLED'),
    categories: ['light'],
    fetch: hamrahMechanicListings,
  },
}

export const providerCatalogue = () => Object.entries(PROVIDERS).map(([key, provider]) => ({
  key, name: provider.name, envKey: provider.envKey, categories: provider.categories, enabled: provider.enabled(),
}))

const status = new Map() // provider → {ok, items, note, lastRun}

// Collect one category from every enabled source. Each provider fails softly and never
// blocks the others — the aggregate simply contains fewer sources that round.
export async function collectExternalListings({ category = 'light', pages = 3 } = {}) {
  const results = []
  for (const [key, provider] of Object.entries(PROVIDERS)) {
    if (!provider.enabled() || !provider.categories.includes(category)) continue
    const started = Date.now()
    try {
      const result = await provider.fetch({ category, pages })
      status.set(key, { ok: true, items: result.items?.length || 0, note: result.note || '', ms: Date.now() - started, lastRun: new Date().toISOString() })
      results.push(result)
    } catch (error) {
      status.set(key, { ok: false, items: 0, note: error.message, ms: Date.now() - started, lastRun: new Date().toISOString() })
    }
  }
  return results
}

export function providerStatuses() {
  return Object.entries(PROVIDERS).map(([key, provider]) => ({
    key,
    name: provider.name,
    envKey: provider.envKey,
    enabled: provider.enabled(),
    categories: provider.categories,
    ...(status.get(key) || { ok: null, items: 0, note: '‍هنوز اجرا نشده است', lastRun: null }),
  }))
}
