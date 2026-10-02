export function canViewRiskInsights(user, subscription) {
  return Boolean(user?.role === 'admin' || (
    subscription?.status === 'active' && ['pro', 'dealer'].includes(subscription.plan)
  ))
}

export function listingForViewer(item, unlocked) {
  if (unlocked) return item
  const { riskFlags: _riskFlags, riskLevel: _riskLevel, ...safe } = item || {}
  return { ...safe, suspicious: false }
}
