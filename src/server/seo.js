// Server-rendered SEO pages for each vehicle model.
//
// WHY
// The platform already computes exactly what people search for — «قیمت پراید ۱۳۱»,
// «قیمت کوییک ۱۴۰۲» — but a SPA shell returns the same empty <div id="root"> for
// every URL, so a crawler sees no content and the data earns no traffic.
//
// These pages are rendered on the server from the stored baseline: real title,
// real description, a readable HTML table and schema.org structured data. The
// React app still hydrates on top, so users get the normal interactive site.

const esc = value => String(value ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;')

const faNumber = value => new Intl.NumberFormat('fa-IR').format(Math.round(Number(value) || 0))
// Years must never be grouped: «۱۳۹۰», not «۱٬۳۹۰».
const faYear = value => new Intl.NumberFormat('fa-IR', { useGrouping: false }).format(Math.round(Number(value) || 0))
const million = value => faNumber((Number(value) || 0) / 1e6)

/** URL-safe slug from a Persian model label: «پراید ۱۳۱» → «پراید-۱۳۱». */
export function slugify(label = '') {
  return String(label)
    .trim()
    .replace(/[\u200c\s]+/g, '-')
    .replace(/[^\p{L}\p{N}-]+/gu, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase()
}

/**
 * Group stored baseline rows into one page per model.
 * Only models with a model-level row (year = 0) and real samples get a page —
 * a page with no numbers on it is worse than no page.
 */
export function buildModelPages(rows = [], { category = 'light', minSamples = 8 } = {}) {
  const byCohort = new Map()
  for (const row of rows) {
    const key = row.cohort_key || row.cohortKey
    if (!key) continue
    if (!byCohort.has(key)) byCohort.set(key, { cohortKey: key, label: row.label || '', segment: row.segment || '', brand: row.brand || '', years: [], overall: null })
    const entry = byCohort.get(key)
    if (!entry.label && row.label) entry.label = row.label
    const year = Number(row.year) || 0
    const color = String(row.color || '')
    if (!year && !color) entry.overall = row
    else if (year && !color) entry.years.push(row)
  }

  const pages = []
  for (const entry of byCohort.values()) {
    if (!entry.overall || !entry.label) continue
    if (Number(entry.overall.samples) < minSamples) continue
    entry.years.sort((a, b) => b.year - a.year)
    pages.push({
      ...entry,
      category,
      slug: slugify(entry.label),
      updatedAt: entry.overall.generated_at || entry.overall.generatedAt || null,
    })
  }
  pages.sort((a, b) => Number(b.overall.samples) - Number(a.overall.samples))
  return pages
}

/**
 * Other models a visitor on this page plausibly wants. Same brand first, then the
 * busiest models in the same segment.
 *
 * WHY IT MATTERS: without these links every model page is an orphan reachable only
 * from the sitemap. Internal links are how a crawler decides a page is worth
 * indexing, and how a visitor who landed on «قیمت پراید ۱۳۱» ever sees anything else.
 */
export function relatedModels(page, pages = [], { limit = 8 } = {}) {
  const others = pages.filter(other => other.slug !== page.slug)
  const sameBrand = others.filter(other => other.brand && other.brand === page.brand)
  const sameSegment = others.filter(other => other.segment === page.segment && !sameBrand.includes(other))
  return [...sameBrand, ...sameSegment].slice(0, limit)
}

function breadcrumbLd(page, origin) {
  const crumbs = [
    { name: 'خودروتو', item: `${origin}/` },
    { name: 'قیمت روز خودرو', item: `${origin}/price` },
    { name: `قیمت ${page.label}`, item: `${origin}/price/${encodeURIComponent(page.slug)}` },
  ]
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: crumbs.map((crumb, index) => ({ '@type': 'ListItem', position: index + 1, name: crumb.name, item: crumb.item })),
  }
}

// Questions people actually type into a search engine, answered with our own data.
function faqLd(page) {
  const overall = page.overall
  const newest = page.years[0]
  const entries = [
    [`قیمت ${page.label} چند است؟`, `میانهٔ قیمت ${page.label} در بازار امروز ${million(overall.median)} میلیون تومان است؛ محدودهٔ متعارف معامله ${million(overall.p25)} تا ${million(overall.p75)} میلیون تومان، بر پایهٔ ${faNumber(overall.samples)} آگهی واقعی در ۳۰ روز گذشته.`],
    ...(newest ? [[`قیمت ${page.label} مدل ${faYear(newest.year)} چند است؟`, `میانهٔ قیمت ${page.label} مدل ${faYear(newest.year)} برابر ${million(newest.median)} میلیون تومان است (${faNumber(newest.samples)} آگهی).`]] : []),
    ['این قیمت‌ها از کجا می‌آید؟', 'از آگهی‌های عمومی بازار؛ آگهی‌های اقساطی، حواله‌ای و قیمت‌های غیرواقعی پیش از میانگین‌گیری با مقایسه با قیمت‌های مرجع کنار گذاشته می‌شوند.'],
  ]
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: entries.map(([question, answer]) => ({
      '@type': 'Question', name: question,
      acceptedAnswer: { '@type': 'Answer', text: answer },
    })),
  }
}

function jsonLd(page, origin) {
  const url = `${origin}/price/${encodeURIComponent(page.slug)}`
  return {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: `قیمت ${page.label}`,
    category: page.segment === 'heavy' ? 'خودرو سنگین' : page.segment === 'motorcycle' ? 'موتورسیکلت' : 'خودرو',
    ...(page.brand ? { brand: { '@type': 'Brand', name: page.brand } } : {}),
    url,
    offers: {
      '@type': 'AggregateOffer',
      priceCurrency: 'IRT',
      lowPrice: Math.round(Number(page.overall.min) || 0),
      highPrice: Math.round(Number(page.overall.max) || 0),
      offerCount: Number(page.overall.samples) || 0,
    },
  }
}

/** The visible, crawlable body injected into the SPA shell. */
export function renderModelBody(page, origin, { related = [] } = {}) {
  const overall = page.overall
  const rows = page.years.map(row => `
      <tr>
        <th scope="row">${esc(page.label)} مدل ${faYear(row.year)}</th>
        <td>${million(row.median)} میلیون تومان</td>
        <td>${million(row.min)} تا ${million(row.max)} میلیون</td>
        <td>${faNumber(row.samples)} آگهی</td>
      </tr>`).join('')

  return `
  <article class="seo-model-page">
    <h1>قیمت ${esc(page.label)}</h1>
    <p>
      میانگین قیمت ${esc(page.label)} در بازار امروز ایران
      <strong>${million(overall.avg)} میلیون تومان</strong>
      و میانهٔ بازار <strong>${million(overall.median)} میلیون تومان</strong> است.
      این عدد از تحلیل ${faNumber(overall.samples)} آگهی واقعی در ۳۰ روز گذشته به‌دست آمده
      و محدودهٔ متعارف معامله بین ${million(overall.p25)} تا ${million(overall.p75)} میلیون تومان است.
    </p>
    ${rows ? `<h2>قیمت ${esc(page.label)} به تفکیک سال ساخت</h2>
    <table>
      <caption>قیمت روز ${esc(page.label)} بر اساس آگهی‌های واقعی بازار</caption>
      <thead><tr><th scope="col">مدل</th><th scope="col">میانهٔ قیمت</th><th scope="col">محدوده</th><th scope="col">نمونه</th></tr></thead>
      <tbody>${rows}
      </tbody>
    </table>` : ''}
    <h2>این قیمت چطور محاسبه می‌شود؟</h2>
    <p>
      خودروتو آگهی‌های عمومی بازار را جمع‌آوری می‌کند، آگهی‌های فیک و اقساطی را با
      مقایسه با قیمت‌های مرجع کنار می‌گذارد، و فقط از آگهی‌های باقی‌مانده میانگین
      می‌گیرد. محاسبه برای هر مدل، هر سال ساخت و هر رنگ جداگانه انجام می‌شود.
      <a href="/methodology">روش کامل محاسبه</a>
    </p>
    <p><a href="/cars?query=${encodeURIComponent(page.label)}">دیدن آگهی‌های ${esc(page.label)}</a></p>
    <p><a href="/estimate">تخمین قیمت خودروی خودتان</a></p>
    ${related.length ? `<h2>قیمت مدل‌های مرتبط</h2>
    <ul class="seo-related">${related.map(other => `
      <li><a href="/price/${encodeURIComponent(other.slug)}">قیمت ${esc(other.label)}</a> — ${million(other.overall.median)} میلیون تومان</li>`).join('')}
    </ul>` : ''}
  </article>`
}

/** The hub that links every model page together: /price */
export function renderIndexBody(pages, origin) {
  const byBrand = new Map()
  for (const page of pages) {
    const brand = page.brand || 'سایر'
    if (!byBrand.has(brand)) byBrand.set(brand, [])
    byBrand.get(brand).push(page)
  }
  const brands = [...byBrand.entries()].sort((a, b) => b[1].length - a[1].length)
  const sections = brands.map(([brand, items]) => `
    <section>
      <h2>${esc(brand)}</h2>
      <ul class="seo-related">${items.map(page => `
        <li><a href="/price/${encodeURIComponent(page.slug)}">قیمت ${esc(page.label)}</a> — ${million(page.overall.median)} میلیون تومان <small>(${faNumber(page.overall.samples)} آگهی)</small></li>`).join('')}
      </ul>
    </section>`).join('')

  return `
  <article class="seo-model-page">
    <h1>قیمت روز خودرو در بازار ایران</h1>
    <p>
      قیمت ${faNumber(pages.length)} مدل خودرو، موتورسیکلت و خودروی سنگین، محاسبه‌شده از
      آگهی‌های واقعی ۳۰ روز گذشته. برای هر مدل، میانهٔ بازار و قیمت به تفکیک سال ساخت
      را می‌بینید. <a href="/methodology">روش محاسبه</a> · <a href="/estimate">تخمین قیمت خودروی شما</a>
    </p>
    ${sections}
  </article>`
}

export function renderIndexPage(shell, pages, { origin = 'https://bidup.ir' } = {}) {
  const title = `قیمت روز خودرو | ${faNumber(pages.length)} مدل بر اساس آگهی‌های واقعی — خودروتو`
  const description = `قیمت روز ${faNumber(pages.length)} مدل خودرو و موتورسیکلت در بازار ایران، محاسبه‌شده از آگهی‌های واقعی ۳۰ روز اخیر، به تفکیک سال ساخت.`
  const url = `${origin}/price`
  const itemList = {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    numberOfItems: pages.length,
    itemListElement: pages.slice(0, 100).map((page, index) => ({
      '@type': 'ListItem', position: index + 1, name: `قیمت ${page.label}`,
      url: `${origin}/price/${encodeURIComponent(page.slug)}`,
    })),
  }
  const head = `
    <title>${esc(title)}</title>
    <meta name="description" content="${esc(description)}"/>
    <link rel="canonical" href="${esc(url)}"/>
    <meta property="og:type" content="website"/>
    <meta property="og:title" content="${esc(title)}"/>
    <meta property="og:description" content="${esc(description)}"/>
    <meta property="og:url" content="${esc(url)}"/>
    <script type="application/ld+json">${JSON.stringify(itemList)}</script>`
  return injectShell(shell, head, renderIndexBody(pages, origin))
}

/** Shared shell surgery for every server-rendered page. */
function injectShell(shell, head, body) {
  let html = shell
  html = html.replace(/<title>[^]*?<\/title>/i, '')
  html = html.replace(/<meta\s+name="description"[^>]*>/i, '')
  html = html.replace('</head>', `${head}\n  </head>`)
  html = html.replace('<div id="root"></div>', `<div id="root"></div>\n    <noscript-content>${body}</noscript-content>`)
  return html
}

/**
 * Inject title, meta, canonical, JSON-LD and the crawlable body into the SPA shell.
 * The React root is left untouched so the client still takes over normally.
 */
export function renderModelPage(shell, page, { origin = 'https://bidup.ir', allPages = [] } = {}) {
  const related = relatedModels(page, allPages)
  const title = `قیمت ${page.label} ${page.years[0] ? `مدل ${faYear(page.years[0].year)} ` : ''}| قیمت روز بازار — خودروتو`
  const description = `قیمت روز ${page.label}: میانگین ${million(page.overall.avg)} میلیون تومان بر اساس ${faNumber(page.overall.samples)} آگهی واقعی ۳۰ روز اخیر. قیمت به تفکیک سال ساخت و محدودهٔ متعارف معامله.`
  const url = `${origin}/price/${encodeURIComponent(page.slug)}`

  const head = `
    <title>${esc(title)}</title>
    <meta name="description" content="${esc(description)}"/>
    <link rel="canonical" href="${esc(url)}"/>
    <meta property="og:type" content="product"/>
    <meta property="og:title" content="${esc(title)}"/>
    <meta property="og:description" content="${esc(description)}"/>
    <meta property="og:url" content="${esc(url)}"/>
    <script type="application/ld+json">${JSON.stringify(jsonLd(page, origin))}</script>
    <script type="application/ld+json">${JSON.stringify(breadcrumbLd(page, origin))}</script>
    <script type="application/ld+json">${JSON.stringify(faqLd(page))}</script>`

  return injectShell(shell, head, renderModelBody(page, origin, { related }))
}

export function renderSitemap(pages, { origin = 'https://bidup.ir', staticPaths = [] } = {}) {
  const today = new Date().toISOString().slice(0, 10)
  // A lastmod that is always "today" teaches a crawler to distrust the field, so
  // each model page reports when its baseline was actually recomputed.
  const dayOf = value => {
    const stamp = Date.parse(value || '')
    return Number.isFinite(stamp) ? new Date(stamp).toISOString().slice(0, 10) : today
  }
  const entries = [
    ...staticPaths.map(path => ({ loc: `${origin}${path}`, priority: path === '/' ? '1.0' : '0.6', changefreq: 'daily', lastmod: today })),
    ...pages.map(page => ({ loc: `${origin}/price/${encodeURIComponent(page.slug)}`, priority: '0.8', changefreq: 'daily', lastmod: dayOf(page.updatedAt) })),
  ]
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries.map(entry => `  <url>
    <loc>${esc(entry.loc)}</loc>
    <lastmod>${entry.lastmod}</lastmod>
    <changefreq>${entry.changefreq}</changefreq>
    <priority>${entry.priority}</priority>
  </url>`).join('\n')}
</urlset>
`
}

export function renderRobots({ origin = 'https://bidup.ir', allow = true } = {}) {
  if (!allow) return `User-agent: *\nDisallow: /\n`
  return `User-agent: *
Allow: /
Disallow: /admin
Disallow: /dashboard
Disallow: /api/

Sitemap: ${origin}/sitemap.xml
`
}
