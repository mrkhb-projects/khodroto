// Vehicle identity resolver.
//
// WHY THIS EXISTS
// The previous cohort key was "first two meaningful tokens of the title". That merged
// genuinely different vehicles into one price pool:
//   «مینی بوس هیوندای کروز مدل ۵۹»  → "مینی بوس"
//   «مینی بوس اسکانیا مدل 2018»     → "مینی بوس"   ← same cohort as a 1959 bus
//   «تریلی ولوو FH»                 → "ولوو"       ← pooled with Volvo passenger cars
//   «پراید ۱۳۱» و «پراید ۱۱۱»        → "پراید"      ← different models, one pool
// Averaging over those pools is what produced the 1250 / 1750 / 2500 nonsense.
//
// The resolver below returns a STRUCTURED identity (segment → type → brand → model)
// so two vehicles only share a price cohort when they are really the same thing.

export const toLatinDigits = value =>
  String(value ?? '').replace(/[۰-۹]/g, d => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d)).replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d))

export function normalizeText(value = '') {
  return toLatinDigits(value)
    .replace(/[يى]/g, 'ی').replace(/ك/g, 'ک').replace(/[ۀة]/g, 'ه')
    .replace(/[\u200c\u200f\u200e]/g, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

const has = (haystack, needle) => ` ${haystack} `.includes(` ${normalizeText(needle)} `)
const hasAny = (haystack, needles) => needles.some(n => has(haystack, n))

// ---------------------------------------------------------------------------
// 1) SEGMENT + TYPE
// Detected from strong structural keywords. Order matters: the most specific
// body style wins ("کامیون کشنده" is a کشنده, not a generic کامیون).
// ---------------------------------------------------------------------------
const TYPE_RULES = [
  { segment: 'heavy', type: 'کشنده', words: ['کشنده', 'تریلی', 'تریلر', 'یدک کش', 'تراکتور کشنده'] },
  { segment: 'heavy', type: 'اتوبوس', words: ['اتوبوس', 'اتوبوس بین شهری', 'بی آر تی'] },
  { segment: 'heavy', type: 'مینی‌بوس', words: ['مینی بوس', 'مینیبوس', 'میدل باس', 'میدلباس'] },
  { segment: 'heavy', type: 'کامیونت', words: ['کامیونت', 'کاميونت'] },
  { segment: 'heavy', type: 'کامیون', words: ['کامیون', 'خاور', 'باری ده تن', 'جفت'] },
  { segment: 'heavy', type: 'ماشین‌آلات راهسازی', words: ['بیل مکانیکی', 'لودر', 'گریدر', 'غلتک', 'بولدوزر', 'جرثقیل', 'بابکت', 'بکهو', 'فینیشر', 'سنگ شکن', 'میکسر', 'پمپ بتن'] },
  { segment: 'heavy', type: 'تراکتور', words: ['تراکتور', 'کمباین', 'تیلر'] },
  { segment: 'motorcycle', type: 'موتورسیکلت', words: ['موتور سیکلت', 'موتورسیکلت', 'موتور سیکلت برقی', 'موتورسیکلت برقی', 'موتور برقی', 'اسکوتر', 'وسپا', 'تریل', 'کراس', 'کلاسیک موتور'] },
  { segment: 'light', type: 'وانت', words: ['وانت', 'نیسان آبی', 'پیکاپ'] },
]

// «موتور» alone is ambiguous (engine part vs motorcycle), so it only counts as a
// motorcycle when the category hint says so or a known bike brand is present.
const MOTO_BRAND_HINT = ['هوندا', 'یاماها', 'باجاج', 'پالس', 'آپاچی', 'کویر', 'احسان', 'نامی', 'پیشرو', 'گلکسی', 'بنلی', 'sym', 'ktm', 'kavir', 'دینو', 'طرح هوندا', 'cg125', 'cdi']

// ---------------------------------------------------------------------------
// 2) BRANDS — scoped per segment so «ولوو» the truck never meets «ولوو» the sedan.
// ---------------------------------------------------------------------------
const BRANDS = {
  heavy: ['بنز', 'مرسدس بنز', 'ولوو', 'اسکانیا', 'ایویکو', 'داف', 'مان', 'رنو', 'هوو', 'سیناتراک', 'شکمن', 'فاو', 'دانگ فنگ', 'فوتون', 'جک', 'کاماز', 'آمیکو', 'ایسوزو', 'هیوندای', 'کیا', 'میتسوبیشی', 'اینترنشنال', 'ماک', 'فرمان', 'آرین', 'کاویان', 'الوند', 'شیلر', 'زامیاد', 'کاترپیلار', 'کوماتسو', 'هپکو', 'لیوگانگ', 'سانی', 'دوسان', 'هیتاچی', 'جاندیر', 'ام ای ان',
    // Newer Chinese/Iranian heavy brands that entered the market recently.
    'آتامان', 'پیلسان', 'دیما', 'کامل', 'سی اند سی', 'بایک', 'امپاور', 'فورس', 'ماموت', 'سیبا', 'تیراژه', 'لاماری', 'اورین', 'شاهین دیزل', 'بهمن دیزل', 'کارسان', 'آرین دیزل'],
  motorcycle: ['هوندا', 'یاماها', 'باجاج', 'تی وی اس', 'آپاچی', 'کویر', 'احسان', 'نامی', 'پیشرو', 'گلکسی', 'بنلی', 'کی وی', 'سیم', 'سوزوکی', 'کاوازاکی', 'ب ام و', 'هارلی', 'وسپا', 'دینو', 'رهرو', 'طرح هوندا', 'ایران دوچرخ', 'نیرو محرکه', 'زونتس', 'لیفان', 'جترو', 'مگلی', 'سحر', 'تکتاز', 'پرواز', 'امیکو',
    'کبیر', 'همتاز', 'متین', 'نیرو پرواز', 'سی اف موتور', 'دارویت', 'نیکران', 'کلیک', 'هورنت', 'اکتیوا'],
  light: ['پراید', 'پژو', 'سمند', 'دنا', 'تارا', 'رانا', 'سورن', 'تیبا', 'ساینا', 'کوییک', 'شاهین', 'اطلس', 'آریا', 'هایما', 'ام وی ام', 'آریزو', 'تیگو', 'فونیکس', 'جک', 'کی ام سی', 'مزدا', 'فیدلیتی', 'دیگنیتی', 'ریسپکت', 'کاپرا', 'رنو', 'ال نود', 'ساندرو', 'استپ وی', 'مگان', 'کولیوس', 'تلیسمان', 'تویوتا', 'هیوندای', 'کیا', 'نیسان', 'میتسوبیشی', 'سوزوکی', 'بی ام و', 'مرسدس بنز', 'بنز', 'لکسوس', 'ولوو', 'پورشه', 'فولکس واگن', 'اشکودا', 'چری', 'لیفان', 'بسترن', 'دانگ فنگ', 'چانگان', 'جیلی', 'لاماری', 'سایپا', 'زامیاد', 'ایران خودرو', 'فیات', 'سیتروئن', 'دوو', 'اپل', 'آئودی', 'جیپ', 'لندرور', 'فورد', 'شورولت', 'هوندا', 'ب ام و', 'مینی کوپر', 'مکث', 'ایلیا'],
}

// Brand aliases → canonical brand.
const BRAND_ALIASES = {
  'مرسدس': 'بنز', 'مرسدس بنز': 'بنز', 'benz': 'بنز', 'volvo': 'ولوو', 'scania': 'اسکانیا',
  'iveco': 'ایویکو', 'اویکو': 'ایویکو', 'daf': 'داف', 'man': 'مان', 'howo': 'هوو',
  'faw': 'فاو', 'foton': 'فوتون', 'isuzu': 'ایسوزو', 'kamaz': 'کاماز',
  'honda': 'هوندا', 'yamaha': 'یاماها', 'bajaj': 'باجاج', 'tvs': 'تی وی اس',
  'sym': 'سیم', 'ktm': 'کی وی', 'benelli': 'بنلی', 'kavir': 'کویر',
  'ام ای ان': 'مان', 'ب ام و': 'بی ام و', 'bmw': 'بی ام و',
  'peugeot': 'پژو', 'pride': 'پراید', 'mvm': 'ام وی ام', 'kmc': 'کی ام سی',
  // Iranians routinely name the bike by its model only («پالس ۱۸۰», «آپاچی ۲۰۰»),
  // so the popular standalone model names resolve to their real brand.
  'پالس': 'باجاج', 'بوکسر': 'باجاج', 'دیسکاور': 'باجاج', 'پلاتینا': 'باجاج',
  'آپاچی': 'تی وی اس', 'ویو': 'هوندا', 'طرح هوندا': 'هوندا', 'cg': 'هوندا',
}

// ---------------------------------------------------------------------------
// 3) MODELS — brand-scoped. Longest match wins so «پژو ۲۰۷» beats «پژو ۲۰۶».
// ---------------------------------------------------------------------------
const MODELS = {
  // ---- heavy ----
  'heavy:بنز': ['۳۰۲', '۳۰۹', '۳۵۵', '۴۵۷', '۹۱۱', '۹۲۴', '۱۰۱۹', '۱۱۱۴', '۱۹۲۴', '۲۶۲۴', '۲۶۳۱', 'اکتروس', 'آروکس', 'آتگو', 'اکسور', 'ال کا', 'تک', 'لوبو'],
  'heavy:ولوو': ['fh', 'fm', 'fmx', 'nh', 'f12', 'f16', 'b7', 'b9', 'b12', 'fl'],
  'heavy:اسکانیا': ['r420', 'r440', 'r450', 'r500', 'g410', 'g420', 'g440', 'p340', 'p360', 'مارال', 'دراگون', 'اینترلاینر', 'سری r', 'سری g', 'سری p'],
  'heavy:ایویکو': ['استرالیس', 'یوروکارگو', 'یوروتک', 'دیلی', 'تراکر'],
  'heavy:هیوندای': ['کروز', 'کانتی', 'شهاب', 'ایچ دی', 'مایتی'],
  'heavy:ایسوزو': ['۶ تن', '۸ تن', '۵ تن', 'ان پی آر', 'ان کیو آر', 'اف وی آر', 'سافاری'],
  'heavy:هوو': ['۳۳۶', '۳۷۱', '۳۸۰', '۴۲۰', 'تی ایکس', 'سایترک'],
  'heavy:فوتون': ['اومان', 'آمان', 'اوویو'],
  'heavy:دانگ فنگ': ['کینگ ران', 'کپتان', 'جی ایکس'],
  'heavy:آمیکو': ['ام تی', 'بردبار', 'سهند', 'دانگ فنگ'],
  'heavy:کاویان': ['کا ۱۰۲۹', 'کا ۱۰۶۹', 'کا ۲۴'],
  'heavy:داف': ['xf', 'cf', 'lf', '۹۵', '۱۰۵'],
  'heavy:مان': ['tgx', 'tgs', 'tga', 'tgm'],
  'heavy:فاو': ['جی ۶', 'جی ۷', 'جی اچ'],
  // ---- motorcycle ----
  'motorcycle:هوندا': ['cg125', 'cdi125', 'cbr', 'cb', 'شادو', 'استارتی', 'طرح', '۱۲۵', '۱۵۰', '۲۰۰'],
  'motorcycle:باجاج': ['پالس', 'بوکسر', 'دیسکاور', 'پلاتینا', 'ان اس', 'rs200', 'ns200', 'ns160', '۱۸۰', '۲۲۰', '۱۵۰', '۱۳۵'],
  'motorcycle:تی وی اس': ['آپاچی', 'استار', 'rtr160', 'rtr180', 'rtr200'],
  'motorcycle:یاماها': ['ویرانو', 'آر ایکس', 'ان مکس', 'وای زد اف', 'r15', 'r25', 'mt'],
  'motorcycle:کویر': ['۲۰۰', '۲۵۰', 'کراس', 'تریل', 'kmc'],
  'motorcycle:بنلی': ['tnt', '۱۵۰', '۲۵۰', '۳۰۰', '۵۰۰', 'لئونچینو'],
  'motorcycle:سیم': ['جت', 'فایتر', 'اوربیت'],
  'motorcycle:احسان': ['۲۰۰', '۲۵۰', 'کراس'],
  'motorcycle:نامی': ['۱۵۰', '۲۰۰', 'ان ام'],
  // ---- light ----
  'light:پراید': ['۱۱۱', '۱۳۱', '۱۳۲', '۱۴۱', '۱۵۱', 'صبا', 'هاچبک', 'سایپا ۱۱۱', 'وانت ۱۵۱'],
  'light:پژو': ['۲۰۶ تیپ ۲', '۲۰۶ تیپ ۳', '۲۰۶ تیپ ۵', '۲۰۶ اس دی', '۲۰۶', '۲۰۷', '۴۰۵', 'پارس', 'روآ', '۳۰۱', '۲۰۸', 'rd', 'glx', 'slx'],
  'light:سمند': ['ال ایکس', 'ای اف ۷', 'سورن', 'سریر', 'دوگانه'],
  'light:تیبا': ['۲', 'هاچبک', 'صندوق دار'],
  'light:ساینا': ['اس', 'جی', 'اتوماتیک'],
  'light:کوییک': ['آر', 'اس', 'جی ایکس', 'پلاس'],
  'light:دنا': ['پلاس', 'توربو', 'معمولی'],
  'light:هایما': ['s5', 's7', '8s', '7x'],
  'light:جک': ['j4', 'j5', 's3', 's5', 'کی ۷', 't8'],
  'light:مزدا': ['۳', '۲', 'وانت', 'کارا'],
  'light:رنو': ['ال نود', 'ساندرو', 'استپ وی', 'مگان', 'کولیوس', 'تلیسمان', 'پارس تندر'],
  'light:تویوتا': ['کرولا', 'کمری', 'لندکروز', 'پرادو', 'راوفور', 'هایلوکس', 'یاریس'],
  'light:هیوندای': ['اکسنت', 'النترا', 'سوناتا', 'آزرا', 'توسان', 'سانتافه', 'ایونیک', 'i20', 'i30'],
  'light:کیا': ['اپتیما', 'سراتو', 'اسپورتیج', 'سورنتو', 'ریو', 'کراس', 'کادنزا', 'پیکانتو'],
  'light:زامیاد': ['z24', 'پادرا', 'آپاچی', 'دیزل'],
  'light:چری': ['آریزو ۵', 'آریزو ۶', 'تیگو ۵', 'تیگو ۷', 'تیگو ۸'],
}

const normalizedModelIndex = (() => {
  const index = new Map()
  for (const [scope, list] of Object.entries(MODELS)) {
    index.set(scope, list.map(m => ({ raw: m, key: normalizeText(m) })).filter(m => m.key).sort((a, b) => b.key.length - a.key.length))
  }
  return index
})()

const normalizedBrands = (() => {
  const out = {}
  for (const [segment, list] of Object.entries(BRANDS)) {
    out[segment] = list.map(b => ({ raw: b, key: normalizeText(b) })).filter(b => b.key.length >= 2).sort((a, b) => b.key.length - a.key.length)
  }
  return out
})()

const normalizedAliases = Object.entries(BRAND_ALIASES).map(([k, v]) => ({ key: normalizeText(k), value: v })).sort((a, b) => b.key.length - a.key.length)

// ---------------------------------------------------------------------------
// Year: unify Jalali and Gregorian onto the Jalali scale so a 2018 Scania and a
// ۱۳۹۷ Scania land in the SAME cohort instead of two broken ones.
// ---------------------------------------------------------------------------
export function normalizeYear(value) {
  const year = Number(toLatinDigits(value))
  if (!Number.isFinite(year) || year <= 0) return 0
  if (year >= 1300 && year <= 1420) return year            // already Jalali
  if (year >= 1900 && year <= 2100) return year - 621      // Gregorian → Jalali
  if (year >= 30 && year <= 99) return 1300 + year         // «مدل ۵۹» → ۱۳۵۹
  if (year >= 0 && year <= 20) return 1400 + year          // «مدل ۰۳» → ۱۴۰۳
  return 0
}

export function extractYear(title = '') {
  const text = toLatinDigits(title)
  // Explicit «مدل/سال» marker first, then a bare 4-digit year, then a bare 2-digit one.
  const patterns = [
    /(?:مدل|سال)\s*(?:ساخت|تولید)?\s*:?\s*(\d{4}|\d{2})(?!\d)/,
    /(?:^|\D)(1[34]\d{2}|19\d{2}|20\d{2})(?!\d)/,
    /(?:^|\D)(\d{2})(?!\d)/,
  ]
  for (const pattern of patterns) {
    const match = text.match(pattern)
    if (match) {
      const year = normalizeYear(match[1])
      if (year) return year
    }
  }
  return 0
}

// Broad market colour: «سفید صدفی» and «سفید» belong together, «—» is unknown.
const COLOR_WORDS = ['سفید', 'مشکی', 'نقره ای', 'خاکستری', 'نوک مدادی', 'آبی', 'سبز', 'قرمز', 'زرد', 'قهوه ای', 'بژ', 'طوسی', 'نارنجی', 'بنفش', 'سربی', 'یشمی', 'زیتونی', 'تیتانیوم', 'دلفینی', 'موکا', 'عنابی', 'کرم']
export function baseColor(color = '') {
  const normalized = normalizeText(color)
  if (!normalized || normalized === '—' || normalized === 'نامشخص') return ''
  for (const word of COLOR_WORDS) { const key = normalizeText(word); if (normalized.includes(key)) return word }
  return normalized.split(' ')[0] || ''
}

function detectTypeAndSegment(normalized, categoryHint) {
  for (const rule of TYPE_RULES) if (hasAny(normalized, rule.words)) return { segment: rule.segment, type: rule.type }
  // Bare «موتور» only becomes a motorcycle with corroboration.
  if (has(normalized, 'موتور') && (categoryHint === 'motorcycles' || hasAny(normalized, MOTO_BRAND_HINT))) {
    return { segment: 'motorcycle', type: 'موتورسیکلت' }
  }
  if (categoryHint === 'motorcycles') return { segment: 'motorcycle', type: 'موتورسیکلت' }
  if (categoryHint === 'heavy') return { segment: 'heavy', type: 'خودرو سنگین' }
  return { segment: 'light', type: 'سواری' }
}

function detectBrand(normalized, segment) {
  for (const alias of normalizedAliases) {
    if (has(normalized, alias.key)) {
      const canonical = alias.value
      if ((BRANDS[segment] || []).includes(canonical)) return canonical
    }
  }
  for (const brand of normalizedBrands[segment] || []) if (has(normalized, brand.key)) return brand.raw
  return ''
}

function detectModel(normalized, segment, brand) {
  if (!brand) return ''
  const list = normalizedModelIndex.get(`${segment}:${brand}`) || []
  const padded = ` ${normalized} `
  // Prefer the trim that sits closest to the brand token («دنا پلاس توربو» → پلاس),
  // breaking ties toward the longer, more specific name («۲۰۶ تیپ ۲» over «۲۰۶»).
  let best = null
  for (const model of list) {
    const at = padded.indexOf(` ${model.key} `)
    if (at === -1) continue
    if (!best || at < best.at || (at === best.at && model.key.length > best.key.length)) best = { ...model, at }
  }
  if (best) return best.raw
  // Alphanumeric trim codes like «R500», «CG125», «FH460» are strong identifiers.
  // Lower-case on purpose: MODELS entries are lower-case, so «R 500» from a price
  // table and «R500» from an ad must collapse to the same cohort key.
  const code = normalized.match(/\b([a-z]{1,3}\s?\d{2,4})\b/)
  if (code) return code[1].replace(/\s+/g, '').toLowerCase()
  return ''
}

/**
 * Resolve the market identity of a listing.
 * `confident` is false when we could not pin down a brand — such listings must NOT
 * be priced off a vague cohort; the pricing engine downgrades them to "no data".
 */
export function identifyVehicle(title = '', categoryHint = 'light') {
  const normalized = normalizeText(title)
  const { segment, type } = detectTypeAndSegment(normalized, categoryHint)
  const brand = detectBrand(normalized, segment)
  const model = detectModel(normalized, segment, brand)
  const parts = [segment, type, brand || '?', model || '?']
  // Keys stay lower-case so «R 500» and «R500» collapse; labels are prettified for
  // display only («e350» → «E350», «tgx» → «TGX»).
  const prettyModel = model.replace(/[a-z]+/g, match => match.toUpperCase())
  return {
    segment,
    type,
    brand,
    model,
    confident: Boolean(brand),
    precise: Boolean(brand && model),
    key: parts.join('|'),
    // Passenger cars read naturally as «پژو ۲۰۷»; heavy/motorcycle need the body
    // type to stay unambiguous («مینی‌بوس بنز ۳۰۲» vs «کامیون بنز ۱۹۲۴»).
    label: segment === 'light'
      ? ([brand, prettyModel].filter(Boolean).join(' ') || type)
      : ([type, brand, prettyModel].filter(Boolean).join(' ') || type),
  }
}

export function cohortKeyOf(title, categoryHint) { return identifyVehicle(title, categoryHint).key }

// ---------------------------------------------------------------------------
// Catalogue surface for the UI filters. The heavy and motorcycle pickers used to
// be hardcoded 5-item lists («ولوو، اسکانیا، بنز، ایویکو، ماک»); they now come
// from the same taxonomy the pricing engine uses, so filters and cohorts agree.
// ---------------------------------------------------------------------------
const SEGMENT_OF_CATEGORY = { motorcycles: 'motorcycle', heavy: 'heavy', light: 'light' }

export function brandsForCategory(category = 'light') {
  const segment = SEGMENT_OF_CATEGORY[category] || 'light'
  return [...BRANDS[segment]].sort((a, b) => a.localeCompare(b, 'fa'))
}

export function modelsForBrand(category = 'light', brand = '') {
  const segment = SEGMENT_OF_CATEGORY[category] || 'light'
  return [...(MODELS[`${segment}:${brand}`] || [])]
}

export function vehicleTypesForCategory(category = 'light') {
  const segment = SEGMENT_OF_CATEGORY[category] || 'light'
  return [...new Set(TYPE_RULES.filter(rule => rule.segment === segment).map(rule => rule.type))]
}

/** Full brand→models tree for one category, used by /api/catalog/vehicles. */
export function catalogForCategory(category = 'light') {
  const segment = SEGMENT_OF_CATEGORY[category] || 'light'
  return {
    category,
    segment,
    types: vehicleTypesForCategory(category),
    brands: brandsForCategory(category).map(brand => ({ brand, models: [...(MODELS[`${segment}:${brand}`] || [])] })),
  }
}
