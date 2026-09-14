import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  deriveUsernames,
  gravatarHash,
  parseEmailSeed,
  runEmailInvestigation,
  socialProfileUrls,
} from '../server/email.ts'
import { parseOptions } from '../server/options.ts'
import { runSpider } from '../server/spider.ts'
import { DEFAULT_OPTIONS, type IntelResult, type ProbeResult, type SpiderEvent } from '../server/types.ts'

describe('email seed detection', () => {
  it('accepts a pasted mailbox and mailto:, rejecting URLs and junk', () => {
    assert.equal(parseEmailSeed('Mitchellkrystin24@gmail.com'), 'Mitchellkrystin24@gmail.com')
    assert.equal(parseEmailSeed('  mailto:ops@northline.sample  '), 'ops@northline.sample')
    assert.equal(parseEmailSeed('<analyst@proton.me>'), 'analyst@proton.me')
    assert.equal(parseEmailSeed('https://example.com'), null)
    assert.equal(parseEmailSeed('https://northline.sample/research'), null)
    assert.equal(parseEmailSeed('not-an-email'), null)
    assert.equal(parseEmailSeed('user@localhost'), null)
    assert.equal(parseEmailSeed('http://user@example.com/path'), null)
  })

  it('does not treat an email as a crawl URL in parseOptions', () => {
    const email = parseOptions({ target: 'Mitchellkrystin24@gmail.com' })
    assert.equal(email.target, 'Mitchellkrystin24@gmail.com')
    assert.match(email.target, /@/)
    assert.doesNotMatch(email.target, /^https?:/i)

    const url = parseOptions({ target: 'https://example.com/path' })
    assert.equal(url.target, 'https://example.com/path')
  })

  it('still reports Invalid URL for non-email garbage', () => {
    assert.throws(() => parseOptions({ target: 'not a url' }), /Invalid URL/)
    assert.throws(() => parseOptions({ target: '' }), /Target URL or email is required/)
    assert.throws(() => parseOptions({ target: 'http://127.0.0.1/' }), /Blocked/)
  })
})

describe('email investigation', () => {
  it('emits local-part/domain intel, Gravatar probe, and unverified social candidates without crawling the email as a URL', async () => {
    const probes: ProbeResult[] = []
    const intel: IntelResult[] = []
    const logs: string[] = []
    const fetched: string[] = []
    const mxDomains: string[] = []

    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input)
      fetched.push(url)
      if (url.includes('gravatar.com/avatar')) {
        return new Response('', { status: 404, headers: { 'content-type': 'image/jpeg' } })
      }
      if (url.includes('gravatar.com') && url.includes('.json')) {
        return new Response('', { status: 404, headers: { 'content-type': 'application/json' } })
      }
      return new Response('', { status: 404 })
    }

    await runEmailInvestigation(
      { ...DEFAULT_OPTIONS, target: 'Mitchellkrystin24@gmail.com', delayMs: 0 },
      (event: SpiderEvent) => {
        if (event.type === 'probe') probes.push(event.probe)
        if (event.type === 'intel') intel.push(event.intel)
        if (event.type === 'log') logs.push(event.log.message)
      },
      new AbortController().signal,
      {
        fetch: fetchImpl,
        resolveMx: async (domain) => {
          mxDomains.push(domain)
          return [{ exchange: 'gmail-smtp-in.l.google.com', priority: 5 }]
        },
        assertSafe: async (url) => new URL(url),
      },
    )

    assert.ok(
      intel.some((i) => i.type === 'email' && i.value === 'Mitchellkrystin24@gmail.com'),
      'seed email should be intel',
    )
    assert.ok(intel.some((i) => i.type === 'username' && i.value === 'Mitchellkrystin24'))
    assert.ok(intel.some((i) => i.type === 'domain' && i.value === 'gmail.com'))
    assert.ok(intel.some((i) => i.type === 'mx' && i.value.includes('gmail-smtp-in.l.google.com')))
    assert.deepEqual(mxDomains, ['gmail.com'])

    const hash = gravatarHash('Mitchellkrystin24@gmail.com')
    assert.ok(probes.some((p) => p.url.includes(hash) && p.url.includes('gravatar.com')))
    assert.equal(
      probes.some((p) => p.url.includes('Mitchellkrystin24@gmail.com')),
      false,
      'must not probe the email string as a URL',
    )
    assert.equal(fetched.some((u) => u.includes('Mitchellkrystin24@gmail.com')), false)
    assert.ok(fetched.some((u) => u.includes('gravatar.com/avatar/')))

    const github = intel.find((i) => i.type === 'site' && /github\.com\/Mitchellkrystin24/i.test(i.value))
    assert.ok(github, 'GitHub candidate should be emitted')
    assert.match(github!.source, /unverified/i)

    const usernames = deriveUsernames('Mitchellkrystin24')
    assert.ok(usernames.some((u) => u.toLowerCase() === 'mitchellkrystin'))
    assert.ok(socialProfileUrls('mitchellkrystin24').some((p) => p.network === 'Reddit'))

    assert.ok(logs.some((m) => /not crawling the address as a URL/i.test(m)))
    assert.ok(logs.some((m) => /Holehe/i.test(m)))
  })

  it('records a Gravatar hit as intel when the public avatar exists', async () => {
    const intel: IntelResult[] = []
    const fetchImpl: typeof fetch = async (input) => {
      const url = input instanceof Request ? input.url : String(input)
      if (url.includes('gravatar.com/avatar')) {
        return new Response('img', { status: 200, headers: { 'content-type': 'image/jpeg' } })
      }
      if (url.includes('gravatar.com') && url.includes('.json')) {
        return new Response(
          JSON.stringify({
            entry: [{ displayName: 'Krystin', profileUrl: 'https://gravatar.com/krystin' }],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        )
      }
      return new Response('', { status: 404 })
    }

    await runEmailInvestigation(
      { ...DEFAULT_OPTIONS, target: 'analyst@proton.me', delayMs: 0 },
      (event: SpiderEvent) => {
        if (event.type === 'intel') intel.push(event.intel)
      },
      new AbortController().signal,
      {
        fetch: fetchImpl,
        resolveMx: async () => [{ exchange: 'mail.protonmail.ch', priority: 10 }],
        assertSafe: async (url) => new URL(url),
      },
    )

    assert.ok(intel.some((i) => i.source.includes('Gravatar avatar exists')))
    assert.ok(intel.some((i) => i.type === 'username' && i.value === 'Krystin'))
    assert.ok(intel.some((i) => i.value === 'https://gravatar.com/krystin'))
  })

  it('refuses to run the URL spider against an email seed', async () => {
    await assert.rejects(
      () =>
        runSpider(
          { ...DEFAULT_OPTIONS, target: 'ops@northline.sample' },
          () => undefined,
          new AbortController().signal,
        ),
      /email investigation/i,
    )
  })
})
