// Dealer / showroom («آگهی شرکتی») detection.
//
// WHY
// A private seller lists one car at a realistic price. A dealer lists dozens, and the
// bait subset of those ads carries a number that is NOT the cash price of the car —
// it is a down payment, a «حواله», or simply a hook to make the phone ring. Those ads
// are the ones users complained about: «شاهین صفر، ۱٬۴۵۰ میلیون» against a ۲٬۳۶۹ میلیون
// market — 38.8% under, which no private seller of a brand-new car would ever accept.
//
// The platform cannot read Divar's seller type reliably, so dealership is inferred
// from the text of the ad plus how often the same seller appears in a crawl. Each
// signal is weak on its own; the score is what matters.

import { normalizeText } from './vehicle-identity.js'

// Explicit business words. These are near-conclusive on their own.
const STRONG_DEALER_WORDS = [
  'نمایشگاه', 'اتوگالری', 'اتو گالری', 'گالری خودرو', 'نمایندگی', 'شرکت',
  'بورس خودرو', 'بورس ماشین', 'لیزینگ', 'اتوسنتر', 'اتو سنتر', 'خودرو سرا',
  'بنگاه', 'کارخانه', 'شعبه', 'فروشگاه',
]

// Supporting words: common in dealer copy, rare in a genuine private ad.
const SOFT_DEALER_WORDS = [
  'تحویل فوری', 'تحویل روز', 'بدون قرعه کشی', 'ثبت نام', 'حواله', 'پیش فروش',
  'فروش ویژه', 'اقساط', 'قسط', 'پیش پرداخت', 'سند در محل', 'ارسال به سراسر کشور',
  'کارشناسی رایگان', 'بیمه رایگان', 'قیمت استثنایی', 'فروش فوری', 'موجود در نمایشگاه',
  'انواع خودرو', 'تمامی رنگ ها', 'همه رنگ ها', 'صفر کیلومتر', 'آپشن دار',
]

// Title spam: dealers pad titles with separators and repeated model names to catch
// every search term («شاهین Gصفر دنده* شاهین اتومات.پلاس صفرسفید مدل1404»).
function titleSpamSignals(title = '') {
  const signals = []
  const raw = String(title)
  if ((raw.match(/[*×؛,،_|\/\\]/g) || []).length >= 2) signals.push('TITLE_SEPARATORS')
  if (/[\u0600-\u06FF][A-Za-z]|[A-Za-z][\u0600-\u06FF]/.test(raw.replace(/\s/g, ''))) signals.push('TITLE_GLUED_SCRIPTS')
  if (raw.length > 55) signals.push('TITLE_TOO_LONG')
  const words = normalizeText(raw).split(/\s+/).filter(w => w.length > 2)
  const seen = new Set(), repeated = new Set()
  for (const word of words) { if (seen.has(word)) repeated.add(word); seen.add(word) }
  if (repeated.size >= 1) signals.push('TITLE_REPEATED_MODEL')
  return signals
}

/**
 * Decide whether a listing is a dealer/company ad.
 *
 * @param item                normalised listing
 * @param opts.sellerAdCount  how many ads this seller has in the current crawl
 * @returns {{dealer:boolean, confidence:number, signals:string[], reason:string}}
 */
export function detectDealer(item = {}, { sellerAdCount = 0 } = {}) {
  const signals = []
  let weight = 0

  const haystack = normalizeText(`${item.title || ''} ${item.description || ''} ${item.sellerName || ''}`)

  for (const word of STRONG_DEALER_WORDS) {
    if (haystack.includes(normalizeText(word))) { signals.push(`DEALER_WORD:${word}`); weight += 3; break }
  }
  let softHits = 0
  for (const word of SOFT_DEALER_WORDS) {
    if (haystack.includes(normalizeText(word))) { softHits += 1; signals.push(`DEALER_HINT:${word}`) }
  }
  weight += Math.min(3, softHits) * 1.2

  // Divar/Bama sometimes expose the seller type directly — trust it when present.
  const sellerType = normalizeText(item.seller || item.sellerType || '')
  if (sellerType && /نمایشگاه|شرکت|بنگاه|dealer|business/.test(sellerType)) { signals.push('SELLER_TYPE'); weight += 3 }

  const spam = titleSpamSignals(item.title)
  signals.push(...spam)
  weight += Math.min(2, spam.length) * 0.8

  // One phone number behind many simultaneous ads is a shop, not a person.
  if (sellerAdCount >= 5) { signals.push('SELLER_MANY_ADS'); weight += 3 }
  else if (sellerAdCount >= 3) { signals.push('SELLER_MULTI_ADS'); weight += 1 }

  const confidence = Math.min(100, Math.round((weight / 6) * 100))
  const dealer = weight >= 3
  return {
    dealer,
    confidence,
    signals,
    reason: dealer ? 'نشانه‌های آگهی شرکتی/نمایشگاهی در این آگهی دیده می‌شود' : '',
  }
}

export const DEALER_WORDS = STRONG_DEALER_WORDS
