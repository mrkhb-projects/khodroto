// Shared presentation for opportunity tiers.
//
// WHY THIS FILE EXISTS
// The tier logic lived only in pages.jsx, so the home page kept scoring cards with
// the old score-threshold rule while /cars used tiers. The same listing could show
// as «طلایی» in one place and plain in the other — the quickest way to make users
// stop trusting the badge. Both pages now read from here.
//
// The server (src/server/opportunity.js) remains the authority; this is styling
// plus a fallback for payloads cached before tiering existed.

export const TIER_STYLE = {
  golden: { label: 'فرصت طلایی', marker: '★', color: '#b8860b', card: '1' },
  silver: { label: 'زیر قیمت بازار', marker: '◆', color: '#2e7d5b', card: '2' },
  bronze: { label: 'کمی زیر بازار', marker: '●', color: '#4a6b8a', card: '3' },
  fair: { label: 'قیمت بازار', marker: '=', color: '#5a6572', card: '4' },
  above: { label: 'بالاتر از بازار', marker: '▲', color: '#a85b32', card: '5' },
  high: { label: 'بسیار گران‌تر از بازار', marker: '▲▲', color: '#8c2f2f', card: '5' },
  suspicious: { label: 'مشکوک یا شرکتی', marker: '!', color: '#b3261e', card: '6' },
  unknown: { label: 'داده بازار کافی نیست', marker: '—', color: '#8a8f98', card: '4' },
}

/** Tier for a listing, falling back to the legacy score bands for old payloads. */
export function tierOf(car) {
  if (car?.tier && TIER_STYLE[car.tier]) return TIER_STYLE[car.tier]
  if (car?.suspicious) return TIER_STYLE.suspicious
  if (car?.score == null) return TIER_STYLE.unknown
  if (car.score >= 85) return TIER_STYLE.golden
  if (car.score >= 70) return TIER_STYLE.silver
  if (car.score >= 55) return TIER_STYLE.bronze
  return TIER_STYLE.fair
}

/** Which admin-configured card design to use. */
export function cardStyleFor(car, settings = {}) {
  const tier = car?.tier
  if (tier === 'suspicious') return settings.card_suspicious || '6'
  if (tier === 'golden') return settings.card_golden || '1'
  if (tier === 'silver') return settings.card_good || '2'
  if (tier === 'above' || tier === 'high') return settings.card_expensive || '5'
  if (tier && TIER_STYLE[tier]) return settings.card_fair || '4'
  // Legacy payload: fall back to the configurable score thresholds.
  if (car?.suspicious) return settings.card_suspicious || '6'
  if (car?.score >= Number(settings.score_golden_min || 85)) return settings.card_golden || '1'
  if (car?.score >= Number(settings.score_good_min || 70)) return settings.card_good || '2'
  if (car?.score >= 50) return settings.card_fair || '4'
  return settings.card_expensive || '5'
}

export const scoreStyle = score => ({
  '--score-color': `hsl(${Math.round(Math.max(0, Math.min(100, score || 0)) * 1.25)},65%,40%)`,
  '--score-soft': `hsl(${Math.round(Math.max(0, Math.min(100, score || 0)) * 1.25)},70%,94%)`,
})
