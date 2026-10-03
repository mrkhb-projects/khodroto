// Saved listings.
//
// They used to live only in localStorage, which meant they vanished on a new
// browser or device and no server-side feature could ever use them. They now live
// in the database for signed-in users, with localStorage kept as the anonymous
// fallback and as the source for a one-time import after sign-in.

const PREFIX = 'khodroto:saved:'
const key = token => `${PREFIX}${token}`

/** Everything the browser currently holds. */
export function localSaved() {
  const items = []
  for (let index = 0; index < localStorage.length; index++) {
    const storageKey = localStorage.key(index)
    if (!storageKey?.startsWith(PREFIX)) continue
    const token = storageKey.slice(PREFIX.length)
    try {
      const raw = localStorage.getItem(storageKey)
      // '1' is the shape the very first version wrote; it carries no payload.
      const parsed = raw === '1' ? { id: token, token } : JSON.parse(raw)
      if (parsed && typeof parsed === 'object') items.push({ ...parsed, id: parsed.id || token, token })
    } catch { /* a corrupt entry must not break the list */ }
  }
  return items
}

export const isSavedLocally = token => localStorage.getItem(key(token)) !== null
export const saveLocally = (token, listing) => localStorage.setItem(key(token), JSON.stringify(listing || { id: token, token }))
export const removeLocally = token => localStorage.removeItem(key(token))

/**
 * Mirror a save to the server. Returns false when the user is not signed in, so
 * the caller can fall back to the browser copy rather than lose the save.
 */
export async function pushSave(token, listing) {
  try {
    const response = await fetch('/api/saved', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token, listing }),
    })
    return response.ok
  } catch { return false }
}

export async function pushUnsave(token) {
  try {
    const response = await fetch(`/api/saved/${encodeURIComponent(token)}`, { method: 'DELETE' })
    return response.ok
  } catch { return false }
}

/** Server copy, or null when signed out. */
export async function fetchSaved() {
  try {
    const response = await fetch('/api/saved')
    if (!response.ok) return null
    return await response.json()
  } catch { return null }
}

/**
 * After sign-in, hand the browser's list to the server once. Guarded by a flag so
 * a user who deliberately removed an item does not get it back on every visit.
 */
export async function importLocalOnce() {
  if (localStorage.getItem('khodroto:saved-imported') === '1') return 0
  const items = localSaved()
  if (!items.length) { localStorage.setItem('khodroto:saved-imported', '1'); return 0 }
  try {
    const response = await fetch('/api/saved/import', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ items }),
    })
    if (!response.ok) return 0
    const data = await response.json()
    localStorage.setItem('khodroto:saved-imported', '1')
    return data.imported || 0
  } catch { return 0 }
}
