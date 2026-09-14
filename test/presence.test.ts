import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  interpretChess,
  interpretDuolingo,
  interpretGithubSearch,
  interpretImgur,
  interpretKeybase,
  interpretPinterest,
  interpretSpotify,
  interpretTumblr,
  interpretWordpress,
} from '../server/presence.ts'
import { runUsernameInvestigation } from '../server/username.ts'
import { DEFAULT_OPTIONS, type IntelResult, type SpiderEvent } from '../server/types.ts'

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
})

describe('username investigation', () => {
  it('emits probed profile hits and skips unverified fan-out', async () => {
    const intel: IntelResult[] = []
    const logs: string[] = []
    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input)
      if (url.includes('github.com/octocat')) return new Response('profile', { status: 200 })
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
  })
})
