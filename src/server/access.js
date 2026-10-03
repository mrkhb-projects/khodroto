export function canViewRiskInsights(user, subscription) {
  return Boolean(user?.role === 'admin' || (
    subscription?.status === 'active' && subscription.plan === 'pro'
  ))
}

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
