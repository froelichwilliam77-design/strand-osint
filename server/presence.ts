import { errMessage, isAbortError, probeHttp, sleep } from './http.ts'
import type { IntelResult, SpiderEvent, SpiderOptions } from './types.ts'

export interface OsintDeps {
  fetch?: typeof fetch
  assertSafe?: (url: string) => Promise<URL>
}

export interface PresenceOutcome {
  exists: boolean | null
  evidence: string
  extra?: string
  rateLimited?: boolean
}

export interface EmailModule {
  id: string
  name: string
  domain: string
  method: 'register' | 'login' | 'other'
  request: (email: string) => {
    url: string
    method: 'GET' | 'POST'
    headers?: Record<string, string>
    body?: string
  }
  interpret: (status: number, body: string) => PresenceOutcome
}

export interface UsernameSite {
  id: string
  name: string
  url: (username: string) => string
  interpret: (status: number, body: string, finalUrl: string) => PresenceOutcome
}

/** Holehe-inspired email registration checks. Never password-reset (no mailbox contact). */
export const EMAIL_MODULES: EmailModule[] = [
  {
    id: 'gravatar',
    name: 'Gravatar',
    domain: 'gravatar.com',
    method: 'other',
    request: () => ({ url: 'https://www.gravatar.com/', method: 'GET' }),
    interpret: interpretUnused,
  },
  {
    id: 'github',
    name: 'GitHub',
    domain: 'github.com',
    method: 'other',
    request: (email) => ({
      url: `https://api.github.com/search/users?q=${encodeURIComponent(email + ' in:email')}`,
      method: 'GET',
      headers: { accept: 'application/vnd.github+json' },
    }),
    interpret: interpretGithubSearch,
  },
  {
    id: 'keybase',
    name: 'Keybase',
    domain: 'keybase.io',
    method: 'other',
    request: (email) => ({
      url: `https://keybase.io/_/api/1.0/user/lookup.json?email=${encodeURIComponent(email)}`,
      method: 'GET',
    }),
    interpret: interpretKeybase,
  },
  {
    id: 'duolingo',
    name: 'Duolingo',
    domain: 'duolingo.com',
    method: 'other',
    request: (email) => ({
      url: `https://www.duolingo.com/2017-06-30/users?email=${encodeURIComponent(email)}`,
      method: 'GET',
    }),
    interpret: interpretDuolingo,
  },
  {
    id: 'spotify',
    name: 'Spotify',
    domain: 'spotify.com',
    method: 'register',
    request: (email) => ({
      url: `https://spclient.wg.spotify.com/signup/public/v1/account?validate=1&email=${encodeURIComponent(email)}`,
      method: 'GET',
    }),
    interpret: interpretSpotify,
  },
  {
    id: 'wordpress',
    name: 'WordPress.com',
    domain: 'wordpress.com',
    method: 'login',
    request: (email) => ({
      url: `https://public-api.wordpress.com/rest/v1.1/users/${encodeURIComponent(email)}/auth-options?http_envelope=1`,
      method: 'GET',
    }),
    interpret: interpretWordpress,
  },
  {
    id: 'imgur',
    name: 'Imgur',
    domain: 'imgur.com',
    method: 'register',
    request: (email) => ({
      url: 'https://imgur.com/signin/ajax_email_available',
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: `email=${encodeURIComponent(email)}`,
    }),
    interpret: interpretImgur,
  },
  {
    id: 'pinterest',
    name: 'Pinterest',
    domain: 'pinterest.com',
    method: 'register',
    request: (email) => ({
      url: `https://www.pinterest.com/_ngjs/resource/EmailExistsResource/get/?source_url=%2F&data=${encodeURIComponent(
        JSON.stringify({ options: { email }, context: {} }),
      )}`,
      method: 'GET',
    }),
    interpret: interpretPinterest,
  },
  {
    id: 'tumblr',
    name: 'Tumblr',
    domain: 'tumblr.com',
    method: 'register',
    request: (email) => ({
      url: 'https://www.tumblr.com/api/v2/register/account/validate',
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email }),
    }),
    interpret: interpretTumblr,
  },
  {
    id: 'chess',
    name: 'Chess.com',
    domain: 'chess.com',
    method: 'register',
    request: (email) => ({
      url: `https://www.chess.com/callback/email/available?email=${encodeURIComponent(email)}`,
      method: 'GET',
    }),
    interpret: interpretChess,
  },
]

/** Gravatar is handled in email.ts with the MD5 hash; skip the placeholder module. */
export const HOLEHE_EMAIL_MODULES = EMAIL_MODULES.filter((m) => m.id !== 'gravatar')

export const USERNAME_SITES: UsernameSite[] = [
  {
    id: 'github',
    name: 'GitHub',
    url: (u) => `https://github.com/${encodeURIComponent(u)}`,
    interpret: (status, body) => {
      if (status === 404) return { exists: false, evidence: 'HTTP 404' }
      if (status === 200 && /There isn’t a GitHub Pages site here|Not Found/i.test(body) && /signup/i.test(body)) {
        return { exists: false, evidence: 'GitHub not-found page' }
      }
      if (status === 200 && /itemprop="additionalName"|class="vcard"|og:type" content="profile"/i.test(body)) {
        return { exists: true, evidence: 'GitHub profile/org vcard markers' }
      }
      if (status === 200) return { exists: true, evidence: 'HTTP 200 user/org page' }
      return { exists: null, evidence: `HTTP ${status}` }
    },
  },
  {
    id: 'gitlab',
    name: 'GitLab',
    url: (u) => `https://gitlab.com/${encodeURIComponent(u)}`,
    interpret: statusOrNotFound,
  },
  {
    id: 'reddit',
    name: 'Reddit',
    url: (u) => `https://www.reddit.com/user/${encodeURIComponent(u)}/about.json`,
    interpret: (status, body) => {
      if (status === 404) return { exists: false, evidence: 'HTTP 404' }
      if (status === 200) {
        try {
          const parsed = JSON.parse(body) as { kind?: string; data?: { name?: string }; error?: number }
          if (parsed.error === 404) return { exists: false, evidence: 'Reddit error 404' }
          if (parsed.data?.name) return { exists: true, evidence: `Reddit user ${parsed.data.name}`, extra: parsed.data.name }
        } catch {
          return { exists: null, evidence: 'Reddit JSON unreadable' }
        }
        return { exists: true, evidence: 'HTTP 200 about.json' }
      }
      return { exists: null, evidence: `HTTP ${status}` }
    },
  },
  {
    id: 'hackernews',
    name: 'Hacker News',
    url: (u) => `https://news.ycombinator.com/user?id=${encodeURIComponent(u)}`,
    interpret: (status, body) => {
      if (status === 404 || /No such user/i.test(body)) return { exists: false, evidence: 'No such user' }
      if (status === 200 && /karma/i.test(body)) return { exists: true, evidence: 'HN user page with karma' }
      if (status === 200) return { exists: null, evidence: 'HN page without karma marker' }
      return { exists: null, evidence: `HTTP ${status}` }
    },
  },
  {
    id: 'keybase',
    name: 'Keybase',
    url: (u) => `https://keybase.io/${encodeURIComponent(u)}`,
    interpret: statusOrNotFound,
  },
  {
    id: 'npm',
    name: 'npm',
    url: (u) => `https://www.npmjs.com/~${encodeURIComponent(u)}`,
    interpret: statusOrNotFound,
  },
  {
    id: 'pypi',
    name: 'PyPI',
    url: (u) => `https://pypi.org/user/${encodeURIComponent(u)}/`,
    interpret: statusOrNotFound,
  },
  {
    id: 'devto',
    name: 'Dev.to',
    url: (u) => `https://dev.to/${encodeURIComponent(u)}`,
    interpret: statusOrNotFound,
  },
  {
    id: 'aboutme',
    name: 'About.me',
    url: (u) => `https://about.me/${encodeURIComponent(u)}`,
    interpret: (status, body) => {
      if (status === 404) return { exists: false, evidence: 'HTTP 404' }
      if (/page not found|doesn'?t exist|user not found/i.test(body)) return { exists: false, evidence: 'not-found copy' }
      if (status === 200 && /property="og:type"\s+content="profile"/i.test(body)) {
        return { exists: true, evidence: 'About.me og:type profile' }
      }
      if (status === 200) return { exists: null, evidence: 'About.me 200 without profile marker' }
      return { exists: null, evidence: `HTTP ${status}` }
    },
  },
  {
    id: 'linktree',
    name: 'Linktree',
    url: (u) => `https://linktr.ee/${encodeURIComponent(u)}`,
    interpret: (status, body, finalUrl) => {
      if (status === 404) return { exists: false, evidence: 'HTTP 404' }
      if (/page not found|doesn't exist|couldn'?t find/i.test(body)) return { exists: false, evidence: 'not-found copy' }
      if (status === 200 && /linktr\.ee\/login/i.test(finalUrl)) return { exists: null, evidence: 'redirected to login' }
      if (status === 200 && /og:title/i.test(body) && !/linktree is the/i.test(body)) {
        return { exists: true, evidence: 'Linktree og:title on a named page' }
      }
      if (status === 200) return { exists: null, evidence: 'Linktree 200 without a clear profile' }
      return { exists: null, evidence: `HTTP ${status}` }
    },
  },
  {
    id: 'twitch',
    name: 'Twitch',
    url: (u) => `https://www.twitch.tv/${encodeURIComponent(u)}`,
    interpret: (status, body) => {
      if (status === 404) return { exists: false, evidence: 'HTTP 404' }
      if (/Sorry\. Unless you.?ve got a time machine/i.test(body)) return { exists: false, evidence: 'Twitch missing-channel page' }
      if (status === 200 && /og:type" content="profile"/i.test(body)) return { exists: true, evidence: 'Twitch og:type profile' }
      if (status === 200) return { exists: null, evidence: 'Twitch 200 without profile marker (login wall possible)' }
      return { exists: null, evidence: `HTTP ${status}` }
    },
  },
  {
    id: 'youtube',
    name: 'YouTube',
    url: (u) => `https://www.youtube.com/@${encodeURIComponent(u)}`,
    interpret: (status, body) => {
      if (status === 404) return { exists: false, evidence: 'HTTP 404' }
      if (/This page isn't available|This channel doesn't exist/i.test(body)) {
        return { exists: false, evidence: 'YouTube missing-channel copy' }
      }
      if (status === 200 && /subscriber/i.test(body)) return { exists: true, evidence: 'channel page mentions subscribers' }
      if (status === 200) return { exists: null, evidence: 'YouTube 200 without subscriber marker (login wall possible)' }
      return { exists: null, evidence: `HTTP ${status}` }
    },
  },
  {
    id: 'soundcloud',
    name: 'SoundCloud',
    url: (u) => `https://soundcloud.com/${encodeURIComponent(u)}`,
    interpret: (status, body) => {
      if (status === 404) return { exists: false, evidence: 'HTTP 404' }
      if (/We can.?t find that user|page not found/i.test(body)) return { exists: false, evidence: 'SoundCloud missing user' }
      if (status === 200 && /og:type" content="profile"/i.test(body)) return { exists: true, evidence: 'SoundCloud profile og:type' }
      if (status === 200) return { exists: null, evidence: 'SoundCloud 200 without profile marker' }
      return { exists: null, evidence: `HTTP ${status}` }
    },
  },
  {
    id: 'telegram',
    name: 'Telegram',
    url: (u) => `https://t.me/${encodeURIComponent(u)}`,
    interpret: (status, body) => {
      if (status === 404) return { exists: false, evidence: 'HTTP 404' }
      if (/If you have .+ installed/i.test(body) && /tg:\/\/resolve/i.test(body)) {
        return { exists: true, evidence: 'Telegram resolve page' }
      }
      if (status === 200) return { exists: null, evidence: 'Telegram 200 without resolve marker' }
      return { exists: null, evidence: `HTTP ${status}` }
    },
  },
]

function interpretUnused(): PresenceOutcome {
  return { exists: null, evidence: 'unused' }
}

export function interpretGithubSearch(status: number, body: string): PresenceOutcome {
  if (status === 403 || status === 429) return { exists: null, evidence: `rate limited (${status})`, rateLimited: true }
  if (status !== 200) return { exists: null, evidence: `HTTP ${status}` }
  try {
    const parsed = JSON.parse(body) as { total_count?: number; items?: Array<{ login?: string; html_url?: string }> }
    const count = parsed.total_count ?? 0
    const login = parsed.items?.[0]?.login
    if (count > 0) {
      return {
        exists: true,
        evidence: `GitHub user search in:email matched ${count} public profile(s)`,
        extra: login,
      }
    }
    return { exists: false, evidence: 'No public GitHub profile lists this email (private emails will not match)' }
  } catch {
    return { exists: null, evidence: 'GitHub search JSON unreadable' }
  }
}

export function interpretKeybase(status: number, body: string): PresenceOutcome {
  if (status !== 200) return { exists: null, evidence: `HTTP ${status}` }
  try {
    const parsed = JSON.parse(body) as { status?: { code?: number }; them?: unknown[] }
    if (parsed.status?.code === 205) return { exists: false, evidence: 'Keybase lookup code 205 (not found)' }
    if (parsed.status?.code === 0 && Array.isArray(parsed.them) && parsed.them.length > 0) {
      return { exists: true, evidence: 'Keybase public lookup matched' }
    }
    if (parsed.status?.code === 0) return { exists: false, evidence: 'Keybase lookup empty' }
    return { exists: null, evidence: `Keybase status ${parsed.status?.code ?? 'unknown'}` }
  } catch {
    return { exists: null, evidence: 'Keybase JSON unreadable' }
  }
}

export function interpretDuolingo(status: number, body: string): PresenceOutcome {
  if (status === 429) return { exists: null, evidence: 'rate limited', rateLimited: true }
  if (status !== 200) return { exists: null, evidence: `HTTP ${status}` }
  try {
    const parsed = JSON.parse(body) as { users?: unknown[] }
    if (Array.isArray(parsed.users) && parsed.users.length > 0) {
      return { exists: true, evidence: 'Duolingo users[] non-empty' }
    }
    return { exists: false, evidence: 'Duolingo users[] empty' }
  } catch {
    return { exists: null, evidence: 'Duolingo JSON unreadable' }
  }
}

export function interpretSpotify(status: number, body: string): PresenceOutcome {
  if (status === 429) return { exists: null, evidence: 'rate limited', rateLimited: true }
  try {
    const parsed = JSON.parse(body) as { status?: number }
    if (parsed.status === 20) return { exists: true, evidence: 'Spotify signup validate status 20 (taken)' }
    if (parsed.status === 1) return { exists: false, evidence: 'Spotify signup validate status 1 (available)' }
    return { exists: null, evidence: `Spotify status ${parsed.status ?? status}`, rateLimited: true }
  } catch {
    return { exists: null, evidence: `HTTP ${status}, Spotify JSON unreadable` }
  }
}

export function interpretWordpress(status: number, body: string): PresenceOutcome {
  if (status === 404) return { exists: false, evidence: 'HTTP 404 unknown user' }
  try {
    const parsed = JSON.parse(body) as { body?: { email_verified?: boolean; error?: string }; code?: string | number; error?: string }
    const inner = parsed.body ?? parsed
    const blob = JSON.stringify(parsed)
    if ('email_verified' in (inner as object)) {
      return inner.email_verified
        ? { exists: true, evidence: 'WordPress.com auth-options email_verified' }
        : { exists: false, evidence: 'WordPress.com email_verified false' }
    }
    if (/unknown_user|email_login_not_allowed/i.test(blob)) {
      return { exists: false, evidence: 'WordPress.com unknown_user' }
    }
    if (status >= 400) return { exists: null, evidence: `HTTP ${status}` }
    return { exists: null, evidence: 'WordPress.com response inconclusive' }
  } catch {
    return { exists: null, evidence: `HTTP ${status}` }
  }
}

export function interpretImgur(status: number, body: string): PresenceOutcome {
  if (status === 429) return { exists: null, evidence: 'rate limited', rateLimited: true }
  try {
    const parsed = JSON.parse(body) as { data?: { available?: boolean } | boolean; available?: boolean }
    const available = typeof parsed.data === 'object' ? parsed.data?.available : parsed.available
    if (available === true) return { exists: false, evidence: 'Imgur email available' }
    if (available === false) return { exists: true, evidence: 'Imgur email not available (registered)' }
    return { exists: null, evidence: `HTTP ${status} inconclusive` }
  } catch {
    return { exists: null, evidence: `HTTP ${status}` }
  }
}

export function interpretPinterest(status: number, body: string): PresenceOutcome {
  if (status === 429) return { exists: null, evidence: 'rate limited', rateLimited: true }
  try {
    const parsed = JSON.parse(body) as {
      resource_response?: { data?: boolean | { email_exists?: boolean } }
      data?: { email_exists?: boolean }
    }
    const data = parsed.resource_response?.data
    if (data === true) return { exists: true, evidence: 'Pinterest EmailExistsResource true' }
    if (data === false) return { exists: false, evidence: 'Pinterest EmailExistsResource false' }
    if (typeof data === 'object' && data && 'email_exists' in data) {
      return data.email_exists
        ? { exists: true, evidence: 'Pinterest email_exists true' }
        : { exists: false, evidence: 'Pinterest email_exists false' }
    }
    return { exists: null, evidence: `HTTP ${status} inconclusive` }
  } catch {
    return { exists: null, evidence: `HTTP ${status}` }
  }
}

export function interpretTumblr(status: number, body: string): PresenceOutcome {
  if (status === 429) return { exists: null, evidence: 'rate limited', rateLimited: true }
  try {
    const parsed = JSON.parse(body) as { response?: { error?: string }; meta?: { status?: number }; errors?: Array<{ code?: number; detail?: string }> }
    const blob = JSON.stringify(parsed)
    if (/email.*already.*used|already_registered|user_already_exists/i.test(blob)) {
      return { exists: true, evidence: 'Tumblr validate: email already used' }
    }
    if (status === 200 && /ok/i.test(blob) && !/error/i.test(blob)) {
      return { exists: false, evidence: 'Tumblr validate accepted email' }
    }
    if (status === 400 && /invalid/i.test(blob)) return { exists: false, evidence: 'Tumblr invalid email' }
    return { exists: null, evidence: `HTTP ${status} inconclusive` }
  } catch {
    return { exists: null, evidence: `HTTP ${status}` }
  }
}

export function interpretChess(status: number, body: string): PresenceOutcome {
  if (status !== 200) return { exists: null, evidence: `HTTP ${status}` }
  try {
    const parsed = JSON.parse(body) as { isEmailAvailable?: boolean; valid?: boolean }
    if (parsed.isEmailAvailable === false) return { exists: true, evidence: 'Chess.com isEmailAvailable false (taken)' }
    if (parsed.isEmailAvailable === true) return { exists: false, evidence: 'Chess.com isEmailAvailable true' }
    return { exists: null, evidence: 'Chess.com JSON missing isEmailAvailable' }
  } catch {
    return { exists: null, evidence: 'Chess.com JSON unreadable' }
  }
}

function statusOrNotFound(status: number, body: string): PresenceOutcome {
  if (status === 404) return { exists: false, evidence: 'HTTP 404' }
  if (/page not found|doesn'?t exist|user not found|couldn'?t find/i.test(body) && status === 200) {
    return { exists: false, evidence: 'not-found copy on HTTP 200' }
  }
  if (status === 200) return { exists: true, evidence: 'HTTP 200' }
  return { exists: null, evidence: `HTTP ${status}` }
}

export async function runEmailModules(
  email: string,
  options: SpiderOptions,
  emit: (event: SpiderEvent) => void,
  signal: AbortSignal,
  deps: OsintDeps,
  counters: { probed: number; skipped: number; intel: number },
): Promise<void> {
  const modules = HOLEHE_EMAIL_MODULES
  const limit = Math.max(1, Math.min(3, options.workers))
  await runPool(modules, limit, signal, options.delayMs, async (mod) => {
    emit({
      type: 'status',
      status: 'running',
      stats: {
        probed: counters.probed,
        forms: 0,
        scripts: 0,
        intel: counters.intel,
        queued: 0,
        skipped: counters.skipped,
      },
      message: `Checking ${mod.name}…`,
    })
    const req = mod.request(email)
    try {
      const result = await probeHttp({
        url: req.url,
        method: req.method,
        userAgent: options.userAgent,
        signal,
        fetchImpl: deps.fetch,
        assertSafe: deps.assertSafe,
        headers: req.headers,
        body: req.body,
        source: `email-check:${mod.id}`,
      })
      counters.probed += 1
      emit({ type: 'probe', probe: result.probe })
      const outcome = mod.interpret(result.probe.status, result.body.toString('utf8'))
      emitAccountIntel(emit, counters, mod.name, mod.domain, req.url, outcome, `holehe-style ${mod.method} check`)
    } catch (err) {
      if (isAbortError(err) || signal.aborted) throw err
      counters.skipped += 1
      emit({
        type: 'log',
        log: { ts: new Date().toISOString(), level: 'warn', message: `${mod.name} check skipped: ${errMessage(err)}` },
      })
    }
  })
}

export async function runUsernameProbes(
  username: string,
  options: SpiderOptions,
  emit: (event: SpiderEvent) => void,
  signal: AbortSignal,
  deps: OsintDeps,
  counters: { probed: number; skipped: number; intel: number },
  sourceLabel = 'username probe',
): Promise<void> {
  const limit = Math.max(1, Math.min(3, options.workers))
  await runPool(USERNAME_SITES, limit, signal, options.delayMs, async (site) => {
    emit({
      type: 'status',
      status: 'running',
      stats: {
        probed: counters.probed,
        forms: 0,
        scripts: 0,
        intel: counters.intel,
        queued: 0,
        skipped: counters.skipped,
      },
      message: `Probing ${site.name}…`,
    })
    const url = site.url(username)
    try {
      const result = await probeHttp({
        url,
        method: 'GET',
        userAgent: options.userAgent,
        signal,
        fetchImpl: deps.fetch,
        assertSafe: deps.assertSafe,
        source: sourceLabel,
      })
      counters.probed += 1
      emit({ type: 'probe', probe: result.probe })
      const outcome = site.interpret(result.probe.status, result.body.toString('utf8'), result.probe.finalUrl)
      emitAccountIntel(
        emit,
        counters,
        site.name,
        new URL(url).hostname,
        result.probe.finalUrl || url,
        outcome,
        `${sourceLabel} (${username})`,
      )
    } catch (err) {
      if (isAbortError(err) || signal.aborted) throw err
      counters.skipped += 1
      emit({
        type: 'log',
        log: { ts: new Date().toISOString(), level: 'warn', message: `${site.name} profile probe skipped: ${errMessage(err)}` },
      })
    }
  })
}

function emitAccountIntel(
  emit: (event: SpiderEvent) => void,
  counters: { intel: number },
  site: string,
  _domain: string,
  url: string,
  outcome: PresenceOutcome,
  source: string,
) {
  if (outcome.rateLimited) {
    emit({
      type: 'log',
      log: { ts: new Date().toISOString(), level: 'warn', message: `${site}: ${outcome.evidence}` },
    })
    return
  }
  if (outcome.exists === true) {
    counters.intel += 1
    const intel: IntelResult = {
      type: 'account',
      value: `${site} · registered`,
      site,
      url,
      source,
      confidence: 'high',
      probed: true,
      exists: true,
      evidence: outcome.evidence,
    }
    emit({ type: 'intel', intel })
    emit({
      type: 'log',
      log: { ts: new Date().toISOString(), level: 'info', message: `${site}: registered (${outcome.evidence})` },
    })
    return
  }
  if (outcome.exists === false) {
    emit({
      type: 'log',
      log: { ts: new Date().toISOString(), level: 'info', message: `${site}: not registered (${outcome.evidence})` },
    })
    return
  }
  emit({
    type: 'log',
    log: { ts: new Date().toISOString(), level: 'warn', message: `${site}: inconclusive (${outcome.evidence})` },
  })
}

async function runPool<T>(
  items: T[],
  limit: number,
  signal: AbortSignal,
  delayMs: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  const queue = [...items]
  const workers = Array.from({ length: Math.max(1, limit) }, async () => {
    while (queue.length && !signal.aborted) {
      const item = queue.shift()
      if (!item) return
      if (delayMs > 0) await sleep(delayMs, signal)
      await fn(item)
    }
  })
  await Promise.all(workers)
}

