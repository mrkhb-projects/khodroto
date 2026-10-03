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
export function renderModelBody(page, origin) {
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
  </article>`
}

/**
 * Inject title, meta, canonical, JSON-LD and the crawlable body into the SPA shell.
 * The React root is left untouched so the client still takes over normally.
 */
export function renderModelPage(shell, page, { origin = 'https://bidup.ir' } = {}) {
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
    <script type="application/ld+json">${JSON.stringify(jsonLd(page, origin))}</script>`

  let html = shell
  // Replace the shell's own title/description rather than duplicating them.
  html = html.replace(/<title>[^]*?<\/title>/i, '')
  html = html.replace(/<meta\s+name="description"[^>]*>/i, '')
  html = html.replace('</head>', `${head}\n  </head>`)
  html = html.replace('<div id="root"></div>', `<div id="root"></div>\n    <noscript-content>${renderModelBody(page, origin)}</noscript-content>`)
  return html
}

export function renderSitemap(pages, { origin = 'https://bidup.ir', staticPaths = [] } = {}) {
  const today = new Date().toISOString().slice(0, 10)
  const entries = [
    ...staticPaths.map(path => ({ loc: `${origin}${path}`, priority: path === '/' ? '1.0' : '0.6', changefreq: 'daily' })),
    ...pages.map(page => ({ loc: `${origin}/price/${encodeURIComponent(page.slug)}`, priority: '0.8', changefreq: 'daily' })),
  ]
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries.map(entry => `  <url>
    <loc>${esc(entry.loc)}</loc>
    <lastmod>${today}</lastmod>
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
