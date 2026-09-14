import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  deriveUsernames,
  gravatarHash,
  parseEmailSeed,
  runEmailInvestigation,
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

  it('still rejects non-email garbage with a parse error', () => {
    assert.throws(() => parseOptions({ target: 'not a url' }), /Could not parse target/)
    assert.throws(() => parseOptions({ target: '' }), /Target is required/)
    assert.throws(() => parseOptions({ target: 'http://127.0.0.1/' }), /Blocked/)
  })
})

describe('email investigation', () => {
  it('emits probed Gravatar/MX/holehe hits and does not dump unverified social URLs as findings', async () => {
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
      if (url.includes('spclient.wg.spotify.com')) {
        return new Response(JSON.stringify({ status: 20 }), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      if (url.includes('api.github.com/search/users')) {
        return new Response(JSON.stringify({ total_count: 1, items: [{ login: 'krystin', html_url: 'https://github.com/krystin' }] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }
      if (url.includes('duolingo.com')) {
        return new Response(JSON.stringify({ users: [{ username: 'krys' }] }), { status: 200 })
      }
      if (url.includes('keybase.io/_/api')) {
        return new Response(JSON.stringify({ status: { code: 205 }, them: [] }), { status: 200 })
      }
      if (url.includes('github.com/Mitchellkrystin24') || url.includes('github.com/mitchellkrystin24')) {
        return new Response('<html>profile</html>', { status: 200 })
      }
      return new Response('', { status: 404 })
    }

    await runEmailInvestigation(
      { ...DEFAULT_OPTIONS, target: 'Mitchellkrystin24@gmail.com', delayMs: 0, workers: 2 },
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

    assert.ok(intel.some((i) => i.type === 'email' && i.value === 'Mitchellkrystin24@gmail.com'))
    assert.ok(intel.some((i) => i.type === 'username' && i.value === 'Mitchellkrystin24'))
    assert.ok(intel.some((i) => i.type === 'domain' && i.value === 'gmail.com'))
    assert.ok(intel.some((i) => i.type === 'mx' && i.value.includes('gmail-smtp-in.l.google.com')))
    assert.deepEqual(mxDomains, ['gmail.com'])

    const hash = gravatarHash('Mitchellkrystin24@gmail.com')
    assert.ok(probes.some((p) => p.url.includes(hash) && p.url.includes('gravatar.com')))
    assert.equal(
      probes.some((p) => p.url === 'Mitchellkrystin24@gmail.com' || /^https?:\/\/Mitchellkrystin24@/i.test(p.url)),
      false,
      'must not probe the email string as a crawl URL',
    )

    const fakeSocial = intel.filter(
      (i) => (i.type === 'site' || i.type === 'account') && /unverified/i.test(i.source) && /github\.com\/Mitchellkrystin24/i.test(i.value),
    )
    assert.equal(fakeSocial.length, 0, 'must not dump unverified GitHub URL guesses as findings')

    const derived = intel.filter((i) => i.confidence === 'unverified')
    assert.ok(derived.every((i) => i.type === 'username'))

    assert.ok(
      intel.some((i) => i.type === 'account' && i.site === 'Spotify' && i.exists === true),
      'Spotify holehe-style hit should stream as registered',
    )
    assert.ok(intel.some((i) => i.type === 'account' && i.site === 'GitHub' && i.exists === true))
    assert.ok(intel.some((i) => i.type === 'account' && i.site === 'Duolingo' && i.exists === true))
    assert.equal(intel.some((i) => i.site === 'Keybase' && i.exists === true), false)

    const usernames = deriveUsernames('Mitchellkrystin24')
    assert.ok(usernames.some((u) => u.toLowerCase() === 'mitchellkrystin'))

    assert.ok(logs.some((m) => /not crawling the address as a URL/i.test(m)))
    assert.ok(logs.some((m) => /Holehe-style/i.test(m)))
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

    assert.ok(intel.some((i) => i.source.includes('Gravatar avatar exists') && i.exists === true && i.confidence === 'high'))
    assert.ok(intel.some((i) => i.type === 'username' && i.value === 'Krystin'))
    assert.ok(intel.some((i) => i.value === 'https://gravatar.com/krystin' || i.url === 'https://gravatar.com/krystin'))
  })

  it('stops an email job on abort without throwing', async () => {
    const abort = new AbortController()
    abort.abort()
    const statuses: string[] = []
    await runEmailInvestigation(
      { ...DEFAULT_OPTIONS, target: 'ops@northline.sample', delayMs: 0 },
      (event) => {
        if (event.type === 'status') statuses.push(event.status)
      },
      abort.signal,
      {
        fetch: async () => new Response('', { status: 404 }),
        resolveMx: async () => [],
        assertSafe: async (url) => new URL(url),
      },
    )
    assert.ok(statuses.includes('stopped'))
    assert.equal(statuses.includes('error'), false)
  })

  it('refuses to run the URL spider against an email seed', async () => {
    await assert.rejects(
      () =>
        runSpider(
          { ...DEFAULT_OPTIONS, target: 'ops@northline.sample' },
          () => undefined,
          new AbortController().signal,
        ),
      /must not use the URL spider/i,
    )
  })
})
