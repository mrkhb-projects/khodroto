export function canViewRiskInsights(user, subscription) {
  return Boolean(user?.role === 'admin' || (
    subscription?.status === 'active' && subscription.plan === 'pro'
  ))
}

export function listingForViewer(item, unlocked) {
  if (unlocked) return item
  const { riskFlags: _riskFlags, riskLevel: _riskLevel, ...safe } = item || {}
  return { ...safe, suspicious: false }
}
