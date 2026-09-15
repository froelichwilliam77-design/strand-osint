import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  HOLEHE_EMAIL_MODULES,
  USERNAME_SITES,
  interpretChess,
  interpretDuolingo,
  interpretFirefox,
  interpretFreelancer,
  interpretGithubSearch,
  interpretHubspot,
  interpretImgur,
  interpretKeybase,
  interpretLastpass,
  interpretMicrosoftLive,
  interpretMicrosoftRealm,
  interpretPinterest,
  interpretProtonmail,
  interpretSpotify,
  interpretTumblr,
  interpretTwitterEmail,
  interpretWordpress,
} from '../server/presence.ts'
import { runUsernameInvestigation } from '../server/username.ts'
import { DEFAULT_OPTIONS, type IntelResult, type SpiderEvent } from '../server/types.ts'
import { isPrimaryIntel, sortIntel } from '../src/lib/utils.ts'

describe('holehe-style interpreters', () => {
  it('treats Spotify status 20 as registered and 1 as available', () => {
    assert.equal(interpretSpotify(200, JSON.stringify({ status: 20 })).exists, true)
    assert.equal(interpretSpotify(200, JSON.stringify({ status: 1 })).exists, false)
    assert.equal(interpretSpotify(200, JSON.stringify({ status: 99 })).exists, null)
  })

  it('reads GitHub public email search hits', () => {
    const hit = interpretGithubSearch(200, JSON.stringify({ total_count: 2, items: [{ login: 'ada' }] }))
    assert.equal(hit.exists, true)
    assert.equal(hit.extra, 'ada')
    assert.equal(interpretGithubSearch(200, JSON.stringify({ total_count: 0, items: [] })).exists, false)
    assert.equal(interpretGithubSearch(403, '{}').rateLimited, true)
  })

  it('reads Keybase, Duolingo, WordPress, Imgur, Pinterest, Tumblr, Chess', () => {
    assert.equal(interpretKeybase(200, JSON.stringify({ status: { code: 0 }, them: [{ id: 1 }] })).exists, true)
    assert.equal(interpretKeybase(200, JSON.stringify({ status: { code: 205 }, them: [] })).exists, false)
    assert.equal(interpretDuolingo(200, JSON.stringify({ users: [{}] })).exists, true)
    assert.equal(interpretDuolingo(200, JSON.stringify({ users: [] })).exists, false)
    assert.equal(
      interpretWordpress(200, JSON.stringify({ body: { email_verified: true } })).exists,
      true,
    )
    assert.equal(interpretImgur(200, JSON.stringify({ data: { available: false } })).exists, true)
    assert.equal(interpretImgur(200, JSON.stringify({ data: { available: true } })).exists, false)
    assert.equal(
      interpretPinterest(200, JSON.stringify({ resource_response: { data: true } })).exists,
      true,
    )
    assert.equal(interpretTumblr(400, JSON.stringify({ errors: [{ detail: 'Email already used' }] })).exists, true)
    assert.equal(interpretChess(200, JSON.stringify({ isEmailAvailable: false })).exists, true)
    assert.equal(interpretChess(200, JSON.stringify({ isEmailAvailable: true })).exists, false)
  })

  it('reads Firefox, Twitter, LastPass, Microsoft, ProtonMail, Freelancer, HubSpot', () => {
    assert.equal(interpretFirefox(200, JSON.stringify({ exists: true })).exists, true)
    assert.equal(interpretFirefox(200, JSON.stringify({ exists: false })).exists, false)
    assert.equal(interpretTwitterEmail(200, JSON.stringify({ taken: true })).exists, true)
    assert.equal(interpretTwitterEmail(200, JSON.stringify({ taken: false })).exists, false)
    assert.equal(interpretLastpass(200, 'no').exists, true)
    assert.equal(interpretLastpass(200, 'ok').exists, false)
    assert.equal(interpretMicrosoftLive(200, JSON.stringify({ IfExistsResult: 0 })).exists, true)
    assert.equal(interpretMicrosoftLive(200, JSON.stringify({ IfExistsResult: 1 })).exists, false)
    assert.equal(interpretMicrosoftRealm(200, JSON.stringify({ NameSpaceType: 'Managed', DomainName: 'contoso.com', Login: 'ada@contoso.com' })).exists, true)
    assert.equal(interpretMicrosoftRealm(200, JSON.stringify({ NameSpaceType: 'Managed', DomainName: 'contoso.com', Login: 'ada@contoso.com' })).confidence, 'medium')
    assert.equal(interpretMicrosoftRealm(200, JSON.stringify({ NameSpaceType: 'Unknown' })).exists, false)
    assert.equal(
      interpretMicrosoftRealm(
        200,
        JSON.stringify({ NameSpaceType: 'Federated', DomainName: 'live.com', FederationBrandName: 'Windows Live', Login: 'test@gmail.com' }),
      ).exists,
      false,
    )
    assert.equal(interpretProtonmail(200, 'info:1:1\n2048:1::').exists, true)
    assert.equal(interpretProtonmail(200, 'info:1:0').exists, false)
    assert.equal(interpretFreelancer(409, '{"error":"EMAIL_ALREADY_IN_USE"}').exists, true)
    assert.equal(interpretFreelancer(200, '{}').exists, false)
    assert.equal(interpretHubspot(400, JSON.stringify({ status: 'INVALID_PASSWORD' })).exists, true)
    assert.equal(interpretHubspot(400, JSON.stringify({ status: 'INVALID_USER' })).exists, false)
  })

  it('covers dozens of email modules and username sites', () => {
    assert.ok(HOLEHE_EMAIL_MODULES.length >= 40, `expected dozens of email modules, got ${HOLEHE_EMAIL_MODULES.length}`)
    assert.ok(USERNAME_SITES.length >= 40, `expected dozens of username sites, got ${USERNAME_SITES.length}`)
    assert.equal(
      HOLEHE_EMAIL_MODULES.some((m) => /reset/i.test(m.method) || /reset/i.test(m.id)),
      false,
      'must not include password-reset modules',
    )
  })
})

describe('intel ranking', () => {
  it('surfaces registered hits first and buries inconclusive / unverified', () => {
    const ranked = sortIntel([
      { type: 'username', value: 'guess', source: 'derived', confidence: 'unverified' },
      { type: 'domain', value: 'gmail.com', source: 'email domain', confidence: 'high' },
      { type: 'account', value: 'Site · inconclusive', source: 'check', confidence: 'low', exists: null, probed: true },
      { type: 'account', value: 'Spotify · registered', site: 'Spotify', source: 'check', confidence: 'high', exists: true, probed: true },
    ])
    assert.equal(ranked[0]?.exists, true)
    assert.equal(ranked[1]?.value, 'gmail.com')
    assert.equal(ranked.at(-1)?.confidence, 'unverified')
    assert.equal(isPrimaryIntel(ranked[0]!), true)
    assert.equal(isPrimaryIntel({ type: 'account', value: 'x', source: 'c', confidence: 'low', exists: null, probed: true }), false)
  })
})

describe('username investigation', () => {
  it('emits probed profile hits and skips unverified fan-out', async () => {
    const intel: IntelResult[] = []
    const logs: string[] = []
    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input)
      if (url.includes('api.github.com/users/octocat')) {
        return new Response(JSON.stringify({ login: 'octocat', type: 'User', html_url: 'https://github.com/octocat' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }
      return new Response('missing', { status: 404 })
    }
    await runUsernameInvestigation(
      { ...DEFAULT_OPTIONS, target: 'octocat', delayMs: 0, workers: 3 },
      (event: SpiderEvent) => {
        if (event.type === 'intel') intel.push(event.intel)
        if (event.type === 'log') logs.push(event.log.message)
      },
      new AbortController().signal,
      { fetch: fetchImpl, assertSafe: async (url) => new URL(url) },
    )
    assert.ok(intel.some((i) => i.type === 'username' && i.value === 'octocat' && i.confidence === 'high'))
    assert.ok(intel.some((i) => i.site === 'GitHub' && i.exists === true && i.probed === true))
    assert.equal(
      intel.filter((i) => i.confidence === 'unverified').length,
      0,
      'username mode should not invent unverified social URLs',
    )
    assert.ok(logs.some((m) => /GitHub: registered/i.test(m)))
    assert.ok(logs.some((m) => /Presence sweep/i.test(m)))
  })

  it('does not treat a generic 200 as an About.me/Twitch hit', async () => {
    const intel: IntelResult[] = []
    const fetchImpl: typeof fetch = async () => new Response('<html><title>Home</title></html>', { status: 200 })
    await runUsernameInvestigation(
      { ...DEFAULT_OPTIONS, target: 'ops', delayMs: 0, workers: 3 },
      (event: SpiderEvent) => {
        if (event.type === 'intel') intel.push(event.intel)
      },
      new AbortController().signal,
      { fetch: fetchImpl, assertSafe: async (url) => new URL(url) },
    )
    assert.equal(intel.some((i) => i.site === 'About.me' && i.exists === true), false)
    assert.equal(intel.some((i) => i.site === 'Twitch' && i.exists === true), false)
    assert.equal(intel.some((i) => i.site === 'Linktree' && i.exists === true), false)
    assert.equal(intel.some((i) => i.site === 'npm' && i.exists === true), false)
    assert.equal(intel.some((i) => i.site === 'Instagram' && i.exists === true), false)
    assert.equal(intel.some((i) => i.site === 'Pinterest' && i.exists === true), false)
    assert.equal(intel.some((i) => i.site === 'Snapchat' && i.exists === true), false)
    assert.equal(intel.some((i) => i.site === 'AniList' && i.exists === true), false)
    assert.equal(intel.some((i) => i.site === 'Hugging Face' && i.exists === true), false)
    const weak = intel.filter((i) => i.exists === null && i.confidence === 'low')
    assert.ok(weak.length > 0, 'inconclusive checks should stream as low-confidence intel')
    assert.ok(weak.every((i) => !isPrimaryIntel(i)))
  })

  it('does not treat site-branding HTML as a registered profile', () => {
    const branding =
      '<html><title>Home</title><meta property="og:title" content="Pinterest"><body>AniList Snapchat Hugging Face Replit Mastodon Tumblr Spotify Flickr DeviantArt Behance Venmo MyAnimeList Kaggle Lemmy</body></html>'
    for (const id of [
      'pinterest',
      'snapchat',
      'anilist',
      'huggingface',
      'replit',
      'mastodon',
      'tumblr',
      'spotify',
      'flickr',
      'deviantart',
      'behance',
      'venmo',
      'myanimelist',
      'kaggle',
      'lemmy',
    ]) {
      const site = USERNAME_SITES.find((s) => s.id === id)
      assert.ok(site, id)
      assert.notEqual(site!.interpret(200, branding, `https://example.invalid/${id}`).exists, true, id)
    }
    const pin = USERNAME_SITES.find((s) => s.id === 'pinterest')!
    assert.equal(
      pin.interpret(200, '<meta property="og:type" content="profile">', 'https://www.pinterest.com/ada/').exists,
      true,
    )
  })

  it('stops username probes when aborted mid-pool', async () => {
    const abort = new AbortController()
    const statuses: string[] = []
    const fetchImpl: typeof fetch = async () => {
      abort.abort()
      throw new Error('aborted')
    }
    await runUsernameInvestigation(
      { ...DEFAULT_OPTIONS, target: 'octocat', delayMs: 0, workers: 2 },
      (event) => {
        if (event.type === 'status') statuses.push(event.status)
      },
      abort.signal,
      { fetch: fetchImpl, assertSafe: async (url) => new URL(url) },
    )
    assert.ok(statuses.includes('stopped'))
    assert.equal(statuses.includes('error'), false)
  })
})
