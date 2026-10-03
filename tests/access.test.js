import { describe, expect, it } from 'vitest'
import { canViewRiskInsights, listingForViewer } from '../src/server/access.js'

describe('subscription-gated suspicious listing insights', () => {
  const suspicious = { id: 'x', title: 'test', suspicious: true, riskFlags: ['قیمت غیرعادی'], riskLevel: 'high' }

  it('unlocks suspicious markers only for active pro/dealer plans and admins', () => {
    expect(canViewRiskInsights(null, null)).toBe(false)
    expect(canViewRiskInsights({ role: 'user' }, { status: 'active', plan: 'free' })).toBe(false)
    expect(canViewRiskInsights({ role: 'user' }, { status: 'expired', plan: 'pro' })).toBe(false)
    expect(canViewRiskInsights({ role: 'user' }, { status: 'active', plan: 'pro' })).toBe(true)
    expect(canViewRiskInsights({ role: 'user' }, { status: 'active', plan: 'dealer' })).toBe(false)
    expect(canViewRiskInsights({ role: 'admin' }, null)).toBe(true)
  })

  // The warning itself is safety information and stays public — otherwise hiding a
  // bait ad by default and revealing it on opt-in would show it with no label at
  // all. What the paywall protects is the forensic detail behind the verdict.
  it('keeps the public warning but strips the forensic detail for free viewers', () => {
    const listing = {
      ...suspicious, tier: 'suspicious', tierLabel: 'مشکوک یا شرکتی', hidden: true,
      hiddenReason: 'اختلاف ۳۸٪ با بازار', hiddenReasons: [{ code: 'DEEP_DISCOUNT' }],
      dealer: true, dealerConfidence: 80, dealerSignals: ['DEALER_WORD:نمایشگاه'], gateCodes: ['TOO_CHEAP'],
    }
    const free = listingForViewer(listing, false)
    expect(free).toMatchObject({ id: 'x', tier: 'suspicious', hidden: true, dealer: true, hiddenReason: 'اختلاف ۳۸٪ با بازار' })
    for (const secret of ['riskFlags', 'riskLevel', 'gateCodes', 'dealerSignals', 'dealerConfidence', 'hiddenReasons']) {
      expect(free).not.toHaveProperty(secret)
    }
    expect(listingForViewer(listing, true)).toBe(listing)
  })
})
