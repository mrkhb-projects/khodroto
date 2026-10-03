// Generic reference-price scraper.
//
// WHY GENERIC
// Iranian price-authority sites nearly all publish the same shape: a table (or a
// repeated card block) whose row carries «نام مدل | سال | قیمت». Hand-writing one
// bespoke parser per site means a dozen fragile files that silently rot. Instead a
// source is declared as DATA in sources.json and parsed by the heuristics below:
//
//   · price → the largest plausible Toman amount in the row
//   · year  → a standalone 13xx/14xx (Jalali) or 19xx/20xx (Gregorian) token
//   · title → the longest Persian text cell, which is the model name
//
// Adding a new price site is then one JSON entry, not a new scraper. If a site
// redesigns, that source reports SHAPE_CHANGED and switches itself off while every
// other source keeps working.

import { fetchText, plausiblePrice, toLatinDigits } from './common.js'

const CURRENT_JALALI_YEAR = 1405

const stripTags = html => html.replace(/<script[^]*?<\/script>/gi, ' ').replace(/<style[^]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, '\u0001')

const cleanCell = text => text
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&zwnj;/g, '\u200c')
  .replace(/\s+/g, ' ')
  .trim()

/** Split a document into candidate rows. */
function extractRows(html, mode) {
  if (mode === 'block') {
    // Card layouts: every price card repeats a wrapper; split on common ones.
    return html.split(/<(?:li|article)\b|class="[^"]*(?:card|item|row|product)[^"]*"/i)
  }
  // Default: real table rows, falling back to <div> groups. Any document with at
  // least one <tr> is a table — a short price table is still a price table.
  const rows = html.split(/<tr\b/i)
  if (rows.length > 1) return rows
  return html.split(/<div\b/i)
}

const YEAR_RE = /(?:^|[^\d])((?:1[34]\d{2}|19\d{2}|20\d{2}))(?![\d])/
const PERSIAN_RE = /[\u0600-\u06FF]/

/**
 * Parse one row into { title, year, price }.
 * Returns null when the row is not a price row.
 */
export function parseRow(rowHtml, { minPrice, maxPrice } = {}) {
  const text = cleanCell(stripTags(rowHtml))
  if (!text || text.length > 600) return null
  const cells = text.split('\u0001').map(cleanCell).filter(Boolean)
  if (!cells.length) return null

  // --- price: scan CELL BY CELL ---------------------------------------------
  // Never scan the whole row as one string: «... CLICK ۱۶۰  1.323.000.000» would
  // merge the model number into the amount and produce 1,601,323,000,000.
  let price = 0
  for (const cell of cells) {
    const latin = toLatinDigits(cell)
    if (latin.includes('%')) continue                       // نوسان column
    if (/\d{4}\/\d{1,2}\/\d{1,2}/.test(latin)) continue    // update-date column
    for (const match of latin.matchAll(/\d[\d,،٬.]*/g)) {
      const raw = match[0]
      // Persian sites write 1,234,567,000 and 1.234.567.000 — both are the same
      // number, but only when the separators are evenly spaced in groups of 3.
      const digits = raw.replace(/[,،٬.]/g, '')
      if (digits.length < 6) continue
      if (/[,،٬.]/.test(raw) && !/^\d{1,3}([,،٬.]\d{3})+$/.test(raw)) continue
      const candidate = Number(digits)
      if (!Number.isFinite(candidate) || !plausiblePrice(candidate)) continue
      if (minPrice && candidate < minPrice) continue
      if (maxPrice && candidate > maxPrice) continue
      if (candidate > price) price = candidate
    }
  }
  if (!price) return null

  // --- year: a standalone 4-digit token, never part of the price ------------
  let year = 0
  for (const cell of cells) {
    const cellLatin = toLatinDigits(cell)
    // Skip cells that are clearly the price or a percentage change.
    if (cellLatin.replace(/[,،٬.\s]/g, '').length >= 7) continue
    if (cellLatin.includes('%')) continue
    const match = cellLatin.match(YEAR_RE)
    if (match) { year = Number(match[1]); break }
  }
  if (!year) {
    const match = toLatinDigits(cells[0] || '').match(YEAR_RE)
    if (match) year = Number(match[1])
  }

  // --- title: longest Persian cell that is not the price --------------------
  const title = cells
    .filter(cell => PERSIAN_RE.test(cell) && cell.replace(/\D/g, '').length < 6)
    .filter(cell => !/بروزرسان|به ?روز ?رسان|مشاهده|جزئیات|نوسان|تومان|قیمت روز|آخرین/.test(cell))
    .sort((a, b) => b.length - a.length)[0] || ''
  if (!title || title.length < 3) return null

  return { title, year, price }
}

/**
 * Scrape one declaratively-configured source.
 * @param source entry from sources.json
 */
export async function scrapeSource(source, { fetchImpl = fetchText } = {}) {
  const urls = Array.isArray(source.urls) ? source.urls : [source.url]
  const rows = []
  const failures = []

  for (const url of urls) {
    let html
    try {
      html = await fetchImpl(url)
    } catch (error) {
      failures.push(`${url}: ${error.message}`)
      continue
    }
    // Optional narrowing so we only read the price section of a long page.
    let scope = html
    if (source.scopeStart) {
      const at = html.indexOf(source.scopeStart)
      if (at >= 0) scope = html.slice(at)
    }
    for (const chunk of extractRows(scope, source.mode)) {
      const parsed = parseRow(chunk, { minPrice: source.minPrice, maxPrice: source.maxPrice })
      if (!parsed) continue
      if (source.titleMustMatch && !new RegExp(source.titleMustMatch).test(parsed.title)) continue
      rows.push({
        ...parsed,
        // «قیمت روز صفر» boards often omit the year; a zero-km price is by
        // definition this year's model.
        year: parsed.year || (source.kind === 'new' ? CURRENT_JALALI_YEAR : 0),
        brand: source.brandPrefix || '',
        model: parsed.title,
        trim: '',
        condition: source.kind || 'used',
        categoryHint: source.categoryHint || 'light',
        url,
      })
    }
  }

  // Deduplicate on title+year, keeping the first (sites list newest first).
  const seen = new Set()
  const unique = rows.filter(row => {
    const key = `${row.title}|${row.year}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })

  if (!unique.length) {
    return { source: source.key, rows: [], note: failures.length ? `FETCH_FAILED: ${failures[0]}` : 'SHAPE_CHANGED — no price rows matched' }
  }
  return { source: source.key, rows: unique, fetchedAt: new Date().toISOString(), note: failures.length ? `PARTIAL — ${failures.length} url(s) failed` : '' }
}
