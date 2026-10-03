// Static guard over the JSX sources.
//
// WHY THIS EXISTS
// A refactor deleted the TierBadge component while every listing card still
// rendered <TierBadge/>. `vite build` succeeded — bundlers do not resolve
// component identifiers — so the breakage was invisible until a card rendered and
// threw ReferenceError. Nothing in the suite could catch that: the e2e tests only
// assert on the server-rendered shell, and there is no DOM renderer here.
//
// So this file parses the JSX and checks that every component used is actually
// defined or imported in the same file. It is a cheap stand-in for a renderer and
// catches exactly the class of mistake that shipped.

import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const srcDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src')
const jsxFiles = fs.readdirSync(srcDir).filter(name => name.endsWith('.jsx'))

/** Component references: <Foo …>, <Foo/>, <Foo.Bar> — capitalised tags only. */
function usedComponents(source) {
  const names = new Set()
  for (const match of source.matchAll(/<([A-Z][A-Za-z0-9_]*)/g)) names.add(match[1])
  return names
}

/**
 * Is the name available in this file?
 *
 * Hand-parsing imports proved fragile (multi-line clauses, aliases, re-exports),
 * so instead: strip every JSX tag mention of the name, then look for the bare
 * identifier. Anything imported or defined still appears somewhere; a component
 * that exists only as `<Foo/>` does not.
 */
function isAvailable(source, name) {
  const withoutTags = source.replace(new RegExp(`</?${name}\\b`, 'g'), '')
  return new RegExp(`\\b${name}\\b`).test(withoutTags)
}

describe.each(jsxFiles)('%s', file => {
  const source = fs.readFileSync(path.join(srcDir, file), 'utf8')

  it('defines or imports every component it renders', () => {
    const missing = [...usedComponents(source)].filter(name => !isAvailable(source, name))
    expect(missing).toEqual([])
  })

})

describe('demo data stays out of signed-in surfaces', () => {
  // Showing invented listings to a real user as "today's opportunities" is worse
  // than showing nothing: the prices are made up.
  const pages = fs.readFileSync(path.join(srcDir, 'pages.jsx'), 'utf8')
  const dashboard = pages.slice(pages.indexOf('export function DashboardPage'))

  it('does not render the sample dataset in the dashboard', () => {
    expect(dashboard).not.toContain('fallbackCars')
  })
})
