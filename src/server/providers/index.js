import { bamaListings } from './bama.js'
import { sheypoorListings } from './sheypoor.js'
import { ringListings } from './ring.js'

// Registry of every market source beyond Divar. All are OFF unless explicitly enabled
// with environment variables, so the proven Divar flow stays the default everywhere.
//   BAMA_ENABLED=true  ·  SHEYPOOR_ENABLED=true  ·  RING_ENABLED=true
const PROVIDERS = {
  bama: {
    name: 'باما',
    enabled: () => process.env.BAMA_ENABLED === 'true',
    categories: ['light', 'motorcycles', 'heavy'],
    fetch: bamaListings,
  },
  sheypoor: {
    name: 'شیپور',
    enabled: () => process.env.SHEYPOOR_ENABLED === 'true',
    categories: ['light', 'motorcycles'],
    fetch: sheypoorListings,
  },
  ring: {
    name: 'رینگ',
    enabled: () => process.env.RING_ENABLED === 'true',
    categories: ['light'],
    fetch: ringListings,
  },
}

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
    enabled: provider.enabled(),
    categories: provider.categories,
    ...(status.get(key) || { ok: null, items: 0, note: '‍هنوز اجرا نشده است', lastRun: null }),
  }))
}
