import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { runSpider } from '../server/spider.ts'
import { inspectUrlSafety } from '../server/ssrf.ts'
import type { FormResult, IntelResult, ProbeResult, SeedResult, SpiderEvent } from '../server/types.ts'

function collect(options: Parameters<typeof runSpider>[0]) {
  const probes: ProbeResult[] = []
  const forms: FormResult[] = []
  const seeds: SeedResult[] = []
  const intel: IntelResult[] = []
  const scripts = new Set<string>()
  const logs: string[] = []
  return runSpider(
    options,
    (event: SpiderEvent) => {
      if (event.type === 'probe') probes.push(event.probe)
      if (event.type === 'form') forms.push(event.form)
      if (event.type === 'seed') seeds.push(event.seed)
      if (event.type === 'intel') intel.push(event.intel)
      if (event.type === 'script') scripts.add(event.url)
      if (event.type === 'log') logs.push(event.log.message)
    },
    new AbortController().signal,
  ).then(() => ({ probes, forms, seeds, intel, scripts, logs }))
}

const base = {
  target: 'https://northline.sample/',
  mode: 'semi-passive' as const,
  scope: 'same-host' as const,
  depth: 4,
  maxPages: 80,
  workers: 4,
  delayMs: 0,
  userAgent: 'Strand spider',
  followSitemaps: true,
  wellKnownSeeds: true,
  parseJsUrls: true,
}

describe('Northline sample crawl', () => {
  it('finds dozens of URLs, forms, JS endpoints, emails, and sitemap-only pages while honoring robots.txt', async () => {
    const result = await collect({ ...base, respectRobots: true })
    const fetched = result.probes.filter((p) => !p.skipped)
    const skipped = result.probes.filter((p) => p.skipped)
    assert.ok(fetched.length >= 25, `expected dozens of probes, got ${fetched.length}`)
    assert.ok(
      fetched.some((p) => p.url.includes('/hidden-archive')),
      'sitemap-only /hidden-archive should be discovered',
    )
    assert.ok(
      skipped.some((p) => p.url.includes('/admin')),
      '/admin should be skipped when robots.txt is respected',
    )
    assert.equal(
      fetched.some((p) => /\/admin(?:\/|$)/.test(new URL(p.url).pathname)),
      false,
      '/admin must not be fetched when robots are respected',
    )
    assert.ok(result.forms.length >= 3, `expected several forms, got ${result.forms.length}`)
    assert.ok(
      result.forms.some((f) => f.fields.some((field) => field.name === 'csrf_token')),
      'login/contact CSRF field should be extracted',
    )
    assert.ok(
      result.intel.some((i) => i.type === 'email' && i.value.includes('security@northline.sample')),
      'should harvest security@northline.sample',
    )
    assert.ok(
      [...result.scripts].some((u) => u.includes('/assets/app.js')) ||
        fetched.some((p) => p.url.includes('/api/v1/catalog')),
      'should discover JS-only API paths',
    )
    assert.ok(result.seeds.some((s) => s.kind === 'sitemap'))
    assert.ok(fetched.some((p) => p.mime.includes('pdf') || p.url.endsWith('.pdf')))
    assert.ok(fetched.some((p) => p.securityHeaders.hsts))
  })

  it('fetches /admin when Respect robots is off', async () => {
    const result = await collect({ ...base, respectRobots: false, maxPages: 80 })
    const fetched = result.probes.filter((p) => !p.skipped)
    assert.ok(
      fetched.some((p) => new URL(p.url).pathname === '/admin'),
      '/admin should be probed when robots are ignored',
    )
  })

  it('HEAD-probes binaries in semi-passive mode', async () => {
    const result = await collect({ ...base, respectRobots: true, maxPages: 80 })
    const pdf = result.probes.find((p) => p.url.endsWith('.pdf') && !p.skipped)
    assert.ok(pdf)
    assert.equal(pdf?.method, 'HEAD')
  })
})

describe('spider target gating', () => {
  it('rejects loopback targets before a crawl starts', () => {
    const result = inspectUrlSafety('http://127.0.0.1:47632/')
    assert.equal(result.ok, false)
  })
})
