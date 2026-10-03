// Plans that include the full analysis: every paid plan, not just «pro».
// The dealer plan costs 499,000 against pro's 199,000, yet it was excluded here —
// so a showroom paying two and a half times as much got no risk insights and, once
// the result cap became real, the same six results as an anonymous visitor.
const PAID_PLANS = new Set(['pro', 'dealer'])

export function canViewRiskInsights(user, subscription) {
  return Boolean(user?.role === 'admin' || (
    subscription?.status === 'active' && PAID_PLANS.has(subscription.plan)
  ))
}

export const paidPlans = () => [...PAID_PLANS]

/**
 * Trim a listing for a viewer without the pro plan.
 *
 * Safety information is NOT a premium feature: every visitor must be able to see
 * that a listing is suspicious or a dealer ad, otherwise hiding it by default makes
 * no sense and an opt-in reveal would show unlabelled bait. What stays behind the
 * paywall is the detailed forensics — which rules fired and how confident we are.
 */
export function listingForViewer(item, unlocked) {
  if (unlocked) return item
  const {
    riskFlags: _riskFlags,
    riskLevel: _riskLevel,
    gateCodes: _gateCodes,
    dealerSignals: _dealerSignals,
    dealerConfidence: _dealerConfidence,
    hiddenReasons: _hiddenReasons,
    priceWarningCodes: _priceWarningCodes,
    ...safe
  } = item || {}
  return safe
}
