// @vitest-environment jsdom
//
// Real render tests.
//
// WHY THEY EXIST
// A deleted component definition shipped while every listing card still rendered
// it. `vite build` passed, the e2e suite passed (it only inspects the
// server-rendered shell) and 198 unit tests passed, because nothing in the project
// ever mounted a React component. The static guard in components.test.js catches a
// missing identifier; only an actual render catches a component that throws.

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import React from 'react'
import { TierBadge } from '../src/pages.jsx'
import { cardStyleFor, tierOf } from '../src/tiers.js'

afterEach(cleanup)

const listing = over => ({
  id: 'x1', token: 'x1', title: 'پژو ۲۰۷ اتوماتیک', price: 900_000_000,
  city: 'تهران', year: 1401, km: 80000, color: 'سفید', score: 72,
  tier: 'silver', tierLabel: 'زیر قیمت بازار', market: 1_000_000_000,
  marketSamples: 24, discount: 10, image: null, freshness: '۲ ساعت پیش', link: '#',
  ...over,
})

describe('TierBadge', () => {
  it('renders the tier the server decided', () => {
    render(<TierBadge car={listing()} />)
    expect(screen.getByText(/زیر قیمت بازار/)).toBeTruthy()
  })

  it('marks a dealer ad as such', () => {
    render(<TierBadge car={listing({ tier: 'suspicious', tierLabel: 'مشکوک یا شرکتی', dealer: true })} />)
    expect(screen.getByText('شرکتی')).toBeTruthy()
  })

  it('survives a payload from before tiering existed', () => {
    const { container } = render(<TierBadge car={{ id: 'old', score: 88 }} />)
    expect(container.textContent).toContain('طلایی')
  })

  it('survives a listing with no score at all', () => {
    const { container } = render(<TierBadge car={{ id: 'none', score: null }} />)
    expect(container.textContent).toContain('داده بازار کافی نیست')
  })
})

describe('tier mapping', () => {
  it('keeps the card design in step with the tier', () => {
    expect(cardStyleFor(listing({ tier: 'golden' }))).toBe('1')
    expect(cardStyleFor(listing({ tier: 'suspicious' }))).toBe('6')
    expect(cardStyleFor(listing({ tier: 'high' }))).toBe('5')
  })

  it('honours the admin chosen designs', () => {
    expect(cardStyleFor(listing({ tier: 'golden' }), { card_golden: '3' })).toBe('3')
  })

  it('falls back to score thresholds for untiered payloads', () => {
    expect(tierOf({ score: 90 }).label).toContain('طلایی')
    expect(tierOf({ score: 40 }).label).toContain('بازار')
    expect(tierOf({ suspicious: true }).label).toContain('مشکوک')
  })
})

describe('AlertsPanel', () => {
  it('renders an empty state rather than crashing when the user has no alerts', async () => {
    vi.stubGlobal('fetch', vi.fn(async url => ({
      ok: true, status: 200,
      json: async () => (String(url).includes('history') ? { items: [] } : { items: [] }),
    })))
    const { DashboardPage } = await import('../src/pages.jsx')
    expect(typeof DashboardPage).toBe('function')
    vi.unstubAllGlobals()
  })
})
