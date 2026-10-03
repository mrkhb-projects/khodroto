import { describe, it, expect } from 'vitest'
import { evaluateListing, visibilityBand, TIERS } from '../src/server/opportunity.js'
import { detectDealer } from '../src/server/dealer.js'
import { parseEnvFile, loadEnvFile } from '../src/server/env.js'
import { parseMileage, extractKmFromText } from '../src/server/divar.js'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// A believable cohort: 64 samples of the same model/year, tight spread.
const cohort = (median = 2_369_000_000) => ({
  median, avg: median, p25: median * 0.94, p75: median * 1.06,
  mad: median * 0.05, samples: 64, dispersion: 0.08,
  level: 'year', label: 'شاهین ۱۴۰۴', identity: { segment: 'light' },
})

const listing = (over = {}) => ({
  id: 't1', token: 't1', title: 'شاهین اتوماتیک', price: 2_100_000_000,
  year: 1404, km: 12000, city: 'تهران', color: 'سفید', image: 'x.jpg', freshness: '۲ ساعت پیش',
  ...over,
})

describe('visibility band', () => {
  it('defaults to the 15–30٪ window operators asked for', () => {
    expect(visibilityBand({})).toMatchObject({ min: 15, max: 30 })
  })

  it('is tunable per host without a redeploy', () => {
    expect(visibilityBand({ OPPORTUNITY_MIN_DISCOUNT: '12', OPPORTUNITY_MAX_DISCOUNT: '25' }))
      .toMatchObject({ min: 12, max: 25 })
  })
})

describe('listings inside the band', () => {
  it('awards the golden tier to a 20٪ discount backed by a solid cohort', () => {
    const market = cohort()
    const verdict = evaluateListing(listing({ price: Math.round(market.median * 0.8) }), market)
    expect(verdict.tier).toBe('golden')
    expect(verdict.hidden).toBe(false)
    expect(verdict.score).toBeGreaterThan(70)
  })

  it('keeps an at-market listing visible but plainly labelled', () => {
    const market = cohort()
    const verdict = evaluateListing(listing({ price: market.median }), market)
    expect(verdict.hidden).toBe(false)
    expect(verdict.tier).toBe('fair')
    expect(verdict.score).toBeLessThanOrEqual(TIERS.fair.cap)
  })

  it('never lets a mid-tier listing score like a golden one', () => {
    const market = cohort()
    const silver = evaluateListing(listing({ price: Math.round(market.median * 0.9) }), market)
    expect(silver.tier).toBe('silver')
    expect(silver.score).toBeLessThanOrEqual(TIERS.silver.cap)
  })
})

describe('listings beyond the band', () => {
  // The exact ad users reported: a brand-new شاهین at 1,450m against a 2,369m market.
  it('hides the 38٪-under شاهین bait ad instead of showing it as an opportunity', () => {
    const market = cohort(2_369_000_000)
    const verdict = evaluateListing(
      listing({ title: 'شاهین Gصفر دنده* شاهین اتومات.پلاس صفرسفید مدل1404', price: 1_450_000_000 }),
      market,
    )
    expect(verdict.hidden).toBe(true)
    expect(verdict.tier).toBe('suspicious')
    expect(verdict.hiddenReasons.map(r => r.code)).toContain('DEEP_DISCOUNT')
    expect(verdict.score).toBeLessThanOrEqual(TIERS.suspicious.cap)
  })

  it('explains in Persian why the listing was pulled from the feed', () => {
    const verdict = evaluateListing(listing({ price: 1_450_000_000 }), cohort())
    expect(verdict.hiddenReason).toMatch(/۳۰|30/)
  })

  it('does not hide a deep discount when the cohort is too thin to prove it', () => {
    const thin = { ...cohort(), samples: 4 }
    const verdict = evaluateListing(listing({ price: 1_450_000_000 }), thin)
    expect(verdict.hiddenReasons.map(r => r.code)).not.toContain('DEEP_DISCOUNT')
  })
})

describe('dealer detection', () => {
  it('flags showroom wording', () => {
    expect(detectDealer({ title: 'پژو ۲۰۷ نمایشگاه اتو کیان' }).dealer).toBe(true)
  })

  it('flags instalment sales copy', () => {
    const result = detectDealer({ title: 'تارا اتوماتیک تحویل فوری', description: 'فروش اقساطی با پیش پرداخت' })
    expect(result.dealer).toBe(true)
  })

  it('treats one seller with many simultaneous ads as a business', () => {
    expect(detectDealer({ title: 'پراید ۱۳۱' }, { sellerAdCount: 6 }).dealer).toBe(true)
  })

  it('leaves an ordinary private ad alone', () => {
    const result = detectDealer({ title: 'پژو پارس مدل ۱۳۹۶', description: 'بیمه تا بهمن' })
    expect(result.dealer).toBe(false)
    expect(result.confidence).toBeLessThan(50)
  })

  it('hides a dealer ad that is also under market, and says so', () => {
    const verdict = evaluateListing(
      listing({ title: 'شاهین نمایشگاه مرکزی', price: Math.round(cohort().median * 0.8) }),
      cohort(),
    )
    expect(verdict.dealer).toBe(true)
    expect(verdict.hidden).toBe(true)
    expect(verdict.hiddenReasons.map(r => r.code)).toContain('DEALER_AD')
  })

  it('can be told to keep dealer ads in the feed', () => {
    const verdict = evaluateListing(
      listing({ title: 'شاهین نمایشگاه مرکزی', price: Math.round(cohort().median * 0.8) }),
      cohort(),
      { env: { HIDE_DEALER_ADS: 'false' } },
    )
    expect(verdict.hidden).toBe(false)
  })
})

describe('mileage parsing', () => {
  it('reads the plain Persian form', () => {
    expect(parseMileage('۱۷۰٬۰۰۰ کیلومتر')).toEqual({ km: 170000, known: true })
  })

  it('reads the «هزار» shorthand without being off by 1000', () => {
    expect(parseMileage('۱۷۰ هزار کیلومتر')).toEqual({ km: 170000, known: true })
  })

  it('treats «صفر» as a known zero, not as missing data', () => {
    expect(parseMileage('صفر')).toEqual({ km: 0, known: true })
  })

  it('reports genuinely missing data as unknown', () => {
    expect(parseMileage('')).toEqual({ km: 0, known: false })
  })

  it('rejects an impossible mileage', () => {
    expect(parseMileage('9999999 کیلومتر').known).toBe(false)
  })

  it('pulls mileage out of a card title', () => {
    expect(extractKmFromText('پژو ۲۰۶ کارکرد ۱۲۰٬۰۰۰ کیلومتر')).toBe(120000)
  })

  it('does not mistake a model year for a mileage', () => {
    expect(extractKmFromText('سمند مدل ۱۴۰۰')).toBe(0)
  })
})

describe('.env loading', () => {
  it('parses comments, quotes and export prefixes', () => {
    const parsed = parseEnvFile([
      '# comment',
      'BAMA_ENABLED=true',
      'export RING_ENABLED="true"',
      "SOURCE_DELAY_MS='1200' ",
      'EMPTY=',
      'INLINE=value # trailing',
    ].join('\n'))
    expect(parsed).toMatchObject({
      BAMA_ENABLED: 'true', RING_ENABLED: 'true', SOURCE_DELAY_MS: '1200', EMPTY: '', INLINE: 'value',
    })
  })

  it('fills missing variables but never overrides the real environment', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'khodroto-env-'))
    fs.writeFileSync(path.join(dir, '.env'), 'BAMA_ENABLED=true\nALREADY=from-file\n')
    const env = { ALREADY: 'from-process' }
    const report = loadEnvFile({ cwd: dir, env })
    expect(env.BAMA_ENABLED).toBe('true')
    expect(env.ALREADY).toBe('from-process')
    expect(report.skipped).toContain('ALREADY')
  })

  it('is a no-op when the host has no .env file', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'khodroto-noenv-'))
    expect(loadEnvFile({ cwd: dir, env: {} })).toBeNull()
  })
})
