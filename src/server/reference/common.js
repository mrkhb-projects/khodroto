// Shared helpers for the reference-price sources.
//
// A "reference price" is NOT an advertisement. It is the market valuation that an
// Iranian price authority publishes daily (همراه مکانیک، بازارخودرو …). We use it as
// an independent anchor so the platform no longer depends only on what sellers on
// Divar *claim* a car is worth.

export const toLatinDigits = value => String(value ?? '').replace(/[۰-۹]/g, d => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d))

/** Parse a Toman amount, rejecting values that are obviously not a car price. */
export function parseToman(value) {
  const latin = toLatinDigits(value).replace(/[٬,\s]/g, '')
  const match = latin.match(/\d{6,}/)
  if (!match) return 0
  const amount = Number(match[0])
  return Number.isFinite(amount) ? amount : 0
}

export async function fetchText(url, { timeoutMs = 20000, headers = {} } = {}) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'user-agent': 'Khodroto Price Reference/1.0 (+https://bidup.ir; daily market price aggregation)',
        accept: 'text/html,application/json;q=0.9,*/*;q=0.8',
        'accept-language': 'fa,en;q=0.5',
        ...headers,
      },
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return await response.text()
  } finally {
    clearTimeout(timer)
  }
}

export const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

/**
 * Sanity envelope for any reference price we ingest. A source that suddenly starts
 * emitting Rials, or a parser that grabs a phone number, must not poison the anchor.
 */
export const PRICE_FLOOR = 50_000_000          // 50 million Toman
export const PRICE_CEILING = 200_000_000_000   // 200 billion Toman

export const plausiblePrice = amount => Number.isFinite(amount) && amount >= PRICE_FLOOR && amount <= PRICE_CEILING

/** Some sources publish Rial; detect and normalise to Toman. */
export function normaliseCurrency(amount, currencyHint = '') {
  if (!amount) return 0
  if (/IRR|ریال/i.test(currencyHint) || amount > PRICE_CEILING) return Math.round(amount / 10)
  return amount
}
