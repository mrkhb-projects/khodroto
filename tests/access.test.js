import { describe, expect, it } from 'vitest'
import { canViewRiskInsights, listingForViewer } from '../src/server/access.js'

describe('subscription-gated suspicious listing insights', () => {
  const suspicious = { id: 'x', title: 'test', suspicious: true, riskFlags: ['قیمت غیرعادی'], riskLevel: 'high' }

  it('unlocks suspicious markers only for active pro/dealer plans and admins', () => {
    expect(canViewRiskInsights(null, null)).toBe(false)
    expect(canViewRiskInsights({ role: 'user' }, { status: 'active', plan: 'free' })).toBe(false)
    expect(canViewRiskInsights({ role: 'user' }, { status: 'expired', plan: 'pro' })).toBe(false)
    expect(canViewRiskInsights({ role: 'user' }, { status: 'active', plan: 'pro' })).toBe(true)
    expect(canViewRiskInsights({ role: 'user' }, { status: 'active', plan: 'dealer' })).toBe(true)
    expect(canViewRiskInsights({ role: 'admin' }, null)).toBe(true)
  })

  it('removes all suspicious markers for viewers without access', () => {
    expect(listingForViewer(suspicious, false)).toEqual({ id: 'x', title: 'test', suspicious: false })
    expect(listingForViewer(suspicious, true)).toBe(suspicious)
  })
})
