import { createHash } from 'node:crypto'
import { promises as dns } from 'node:dns'
import { assertSafeUrl, inspectUrlSafety, SsrfError } from './ssrf.ts'
import type { IntelResult, ProbeResult, SecurityHeaders, SpiderEvent, SpiderOptions } from './types.ts'

const EMAIL_SEED_RE = /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i
const FETCH_TIMEOUT_MS = 10_000
const MAX_REDIRECTS = 8
const MAX_BODY = 400_000

export const MAILBOX_PROVIDERS: Record<string, string> = {
  'gmail.com': 'Google consumer mailbox (dots and +tags are ignored)',
  'googlemail.com': 'Google consumer mailbox (alias of gmail.com)',
  'outlook.com': 'Microsoft Outlook / Hotmail consumer mailbox',
  'hotmail.com': 'Microsoft Outlook / Hotmail consumer mailbox',
  'live.com': 'Microsoft Live consumer mailbox',
  'msn.com': 'Microsoft consumer mailbox',
  'yahoo.com': 'Yahoo Mail',
  'ymail.com': 'Yahoo Mail',
  'icloud.com': 'Apple iCloud Mail',
  'me.com': 'Apple iCloud Mail',
  'mac.com': 'Apple iCloud Mail',
  'proton.me': 'Proton Mail',
  'protonmail.com': 'Proton Mail',
  'pm.me': 'Proton Mail alias',
  'aol.com': 'AOL Mail',
  'gmx.com': 'GMX',
  'gmx.net': 'GMX',
  'zoho.com': 'Zoho Mail',
  'yandex.com': 'Yandex Mail',
  'mail.com': 'mail.com',
  'fastmail.com': 'Fastmail',
  'tutanota.com': 'Tuta',
  'tutamail.com': 'Tuta',
  'hey.com': 'HEY',
}

/** Public profile URL patterns — candidates only, not proof of an account. */
export const SOCIAL_NETWORKS: { name: string; url: (username: string) => string }[] = [
  { name: 'GitHub', url: (u) => `https://github.com/${u}` },
  { name: 'GitLab', url: (u) => `https://gitlab.com/${u}` },
  { name: 'X (Twitter)', url: (u) => `https://x.com/${u}` },
  { name: 'Instagram', url: (u) => `https://www.instagram.com/${u}/` },
  { name: 'Reddit', url: (u) => `https://www.reddit.com/user/${u}` },
  { name: 'LinkedIn', url: (u) => `https://www.linkedin.com/in/${u}` },
  { name: 'TikTok', url: (u) => `https://www.tiktok.com/@${u}` },
  { name: 'YouTube', url: (u) => `https://www.youtube.com/@${u}` },
  { name: 'Facebook', url: (u) => `https://www.facebook.com/${u}` },
  { name: 'Medium', url: (u) => `https://medium.com/@${u}` },
  { name: 'Pinterest', url: (u) => `https://www.pinterest.com/${u}/` },
  { name: 'Twitch', url: (u) => `https://www.twitch.tv/${u}` },
  { name: 'Keybase', url: (u) => `https://keybase.io/${u}` },
  { name: 'Hacker News', url: (u) => `https://news.ycombinator.com/user?id=${u}` },
  { name: 'npm', url: (u) => `https://www.npmjs.com/~${u}` },
  { name: 'Telegram', url: (u) => `https://t.me/${u}` },
  { name: 'About.me', url: (u) => `https://about.me/${u}` },
  { name: 'Linktree', url: (u) => `https://linktr.ee/${u}` },
]

export interface EmailParts {
  email: string
  local: string
  domain: string
}

export interface EmailOsintDeps {
  fetch?: typeof fetch
  resolveMx?: (domain: string) => Promise<Array<{ exchange: string; priority: number }>>
  assertSafe?: (url: string) => Promise<URL>
}

export function parseEmailSeed(raw: string): string | null {
  let s = raw.trim()
  if (!s) return null
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) return null
  if (/^mailto:/i.test(s)) s = s.slice(7).trim()
  s = s.replace(/^<|>$/g, '').trim()
  if (/\s/.test(s) || s.includes('/')) return null
  if (!EMAIL_SEED_RE.test(s)) return null
  return s
}

export function isEmailSeed(raw: string): boolean {
  return parseEmailSeed(raw) !== null
}

export function splitEmail(email: string): EmailParts {
  const normalized = parseEmailSeed(email)
  if (!normalized) throw new Error('Not an email seed')
  const at = normalized.lastIndexOf('@')
  return {
    email: normalized,
    local: normalized.slice(0, at),
    domain: normalized.slice(at + 1).toLowerCase(),
  }
}

export function gravatarHash(email: string): string {
  return createHash('md5').update(email.trim().toLowerCase()).digest('hex')
}

export function deriveUsernames(localPart: string): string[] {
  const untagged = (localPart.split('+')[0] ?? localPart).trim()
  const out: string[] = []
  const add = (value: string) => {
    const t = value.trim()
    if (t.length < 2 || t.length > 39) return
    if (!out.some((x) => x.toLowerCase() === t.toLowerCase())) out.push(t)
  }
  add(untagged)
  const lower = untagged.toLowerCase()
  add(lower)
  add(lower.replace(/[._-]+/g, ''))
  add(lower.replace(/[._]+/g, '-'))
  const strippedDigits = lower.replace(/\d+$/g, '')
  if (strippedDigits !== lower) add(strippedDigits)
  if (lower.includes('.')) add(lower.split('.')[0] ?? '')
  return out
}

export function socialProfileUrls(username: string): Array<{ network: string; url: string }> {
  const encoded = encodeURIComponent(username)
  return SOCIAL_NETWORKS.map((network) => ({ network: network.name, url: network.url(encoded) }))
}

export async function runEmailInvestigation(
  options: SpiderOptions,
  emit: (event: SpiderEvent) => void,
  signal: AbortSignal,
  deps: EmailOsintDeps = {},
): Promise<void> {
  const parts = splitEmail(options.target)
  const fetchImpl = deps.fetch ?? fetch
  const resolveMx = deps.resolveMx ?? ((domain: string) => dns.resolveMx(domain))
  const assertSafe = deps.assertSafe ?? assertSafeUrl
  let probed = 0
  let intel = 0
  let skipped = 0

  const stats = () => ({
    probed,
    forms: 0,
    scripts: 0,
    intel,
    queued: 0,
    skipped,
  })

  const log = (level: 'info' | 'warn' | 'error' | 'skip', message: string) => {
    emit({ type: 'log', log: { ts: new Date().toISOString(), level, message } })
  }

  const pushIntel = (item: IntelResult) => {
    intel += 1
    emit({ type: 'intel', intel: item })
  }

  log(
    'info',
    `Public-records email OSINT for ${parts.email} (not crawling the address as a URL; no mailbox contact)`,
  )
  emit({
    type: 'seed',
    seed: { url: `mailto:${parts.email}`, kind: 'email', detail: 'email seed' },
  })
  emit({ type: 'status', status: 'running', stats: stats(), message: 'Email investigation' })

  pushIntel({ type: 'email', value: parts.email, source: 'seed' })
  pushIntel({ type: 'username', value: parts.local, source: 'email local-part' })
  const provider = MAILBOX_PROVIDERS[parts.domain]
  pushIntel({
    type: 'domain',
    value: parts.domain,
    source: provider ? `email domain · ${provider}` : 'email domain (custom / org mailbox likely)',
  })

  if (signal.aborted) {
    emit({ type: 'status', status: 'stopped', stats: stats(), message: 'Stopped' })
    return
  }

  try {
    const mx = await resolveMx(parts.domain)
    mx.sort((a, b) => a.priority - b.priority)
    if (!mx.length) log('warn', `No MX records for ${parts.domain}`)
    for (const rec of mx.slice(0, 6)) {
      pushIntel({
        type: 'mx',
        value: rec.exchange.replace(/\.$/, ''),
        source: `DNS MX ${parts.domain} (priority ${rec.priority})`,
      })
    }
    if (mx.length) log('info', `MX for ${parts.domain}: ${mx.map((m) => m.exchange).join(', ')}`)
  } catch (err) {
    log('warn', `MX lookup failed for ${parts.domain}: ${errMessage(err)}`)
  }

  const hash = gravatarHash(parts.email)
  pushIntel({
    type: 'site',
    value: `https://www.gravatar.com/${hash}`,
    source: 'Gravatar public hash (MD5 of lowercase email)',
  })

  const avatarUrl = `https://www.gravatar.com/avatar/${hash}?d=404`
  try {
    const avatar = await probeHttp(avatarUrl, 'GET', options.userAgent, signal, fetchImpl, assertSafe)
    probed += 1
    emit({ type: 'probe', probe: avatar.probe })
    if (avatar.probe.status === 200) {
      pushIntel({
        type: 'site',
        value: avatar.probe.finalUrl || avatarUrl,
        source: 'Gravatar avatar exists (public hash check)',
      })
      log('info', `Gravatar avatar found for ${parts.email}`)
    } else if (avatar.probe.status === 404) {
      log('info', 'No public Gravatar avatar for this hash')
    } else {
      log('warn', `Gravatar avatar check returned ${avatar.probe.status}`)
    }
  } catch (err) {
    skipped += 1
    log('warn', `Gravatar avatar check skipped: ${errMessage(err)}`)
  }

  const profileJsonUrl = `https://www.gravatar.com/${hash}.json`
  try {
    const profile = await probeHttp(profileJsonUrl, 'GET', options.userAgent, signal, fetchImpl, assertSafe)
    probed += 1
    emit({ type: 'probe', probe: profile.probe })
    if (profile.probe.status === 200 && profile.body.length) {
      parseGravatarJson(profile.body.toString('utf8'), pushIntel, log)
    } else if (profile.probe.status === 404) {
      log('info', 'No public Gravatar profile JSON for this hash')
    }
  } catch (err) {
    skipped += 1
    log('warn', `Gravatar profile check skipped: ${errMessage(err)}`)
  }

  const usernames = deriveUsernames(parts.local)
  for (const username of usernames) {
    if (username.toLowerCase() === parts.local.toLowerCase()) continue
    pushIntel({ type: 'username', value: username, source: 'derived from local-part (unverified)' })
  }

  const fanoutNames = usernames.slice(0, 2)
  log(
    'info',
    `Emitting unverified profile URL candidates for ${fanoutNames.join(', ')} (not proof of accounts)`,
  )
  for (const username of fanoutNames) {
    for (const profile of socialProfileUrls(username)) {
      pushIntel({
        type: 'site',
        value: profile.url,
        source: `unverified ${profile.network} candidate from local-part "${username}"`,
      })
    }
  }

  if (!provider) {
    const homepage = `https://${parts.domain}/`
    const safety = inspectUrlSafety(homepage)
    if (!safety.ok) {
      log('skip', `Domain homepage probe blocked: ${safety.reason}`)
    } else {
      try {
        const home = await probeHttp(homepage, 'HEAD', options.userAgent, signal, fetchImpl, assertSafe)
        probed += 1
        emit({ type: 'probe', probe: home.probe })
        pushIntel({
          type: 'site',
          value: home.probe.finalUrl || homepage,
          source: `custom-domain homepage (${home.probe.status})`,
        })
      } catch (err) {
        skipped += 1
        log('warn', `Domain homepage probe skipped: ${errMessage(err)}`)
      }
    }
  }

  if (signal.aborted) {
    emit({ type: 'status', status: 'stopped', stats: stats(), message: 'Stopped' })
    log('warn', 'Email investigation stopped')
    return
  }

  log(
    'info',
    `Done — email OSINT ${probed} HTTP checks, ${intel} intel. Holehe-style site-registration modules are not bundled (follow-up).`,
  )
  emit({ type: 'status', status: 'done', stats: stats(), message: `Complete — ${intel} intel (email OSINT)` })
}

function parseGravatarJson(
  body: string,
  pushIntel: (item: IntelResult) => void,
  log: (level: 'info' | 'warn' | 'error' | 'skip', message: string) => void,
) {
  try {
    const parsed = JSON.parse(body) as {
      entry?: Array<{
        preferredUsername?: string
        displayName?: string
        profileUrl?: string
        accounts?: Array<{ domain?: string; url?: string; verified?: boolean; shortname?: string }>
        urls?: Array<{ value?: string; title?: string }>
      }>
    }
    const entry = parsed.entry?.[0]
    if (!entry) return
    log('info', 'Public Gravatar profile JSON found')
    if (entry.displayName) {
      pushIntel({ type: 'username', value: entry.displayName, source: 'Gravatar public profile display name' })
    }
    if (entry.preferredUsername) {
      pushIntel({ type: 'username', value: entry.preferredUsername, source: 'Gravatar preferred username' })
    }
    if (entry.profileUrl) {
      pushIntel({ type: 'site', value: entry.profileUrl, source: 'Gravatar public profile URL' })
    }
    for (const account of entry.accounts ?? []) {
      if (!account.url) continue
      const tag = account.verified ? 'verified' : 'listed'
      pushIntel({
        type: 'site',
        value: account.url,
        source: `Gravatar public profile ${tag} account (${account.shortname || account.domain || 'site'})`,
      })
    }
    for (const extra of entry.urls ?? []) {
      if (!extra.value) continue
      pushIntel({
        type: 'site',
        value: extra.value,
        source: extra.title ? `Gravatar profile link (${extra.title})` : 'Gravatar profile link',
      })
    }
  } catch {
    log('warn', 'Gravatar profile JSON was not parseable')
  }
}

async function probeHttp(
  url: string,
  method: 'GET' | 'HEAD',
  userAgent: string,
  signal: AbortSignal,
  fetchImpl: typeof fetch,
  assertSafe: (url: string) => Promise<URL>,
): Promise<{ probe: ProbeResult; body: Buffer }> {
  let current = url
  const redirectChain: string[] = []
  let lastHeaders = new Headers()
  for (let i = 0; i < MAX_REDIRECTS; i += 1) {
    if (signal.aborted) throw new Error('aborted')
    await assertSafe(current)
    const controller = AbortSignal.any([signal, AbortSignal.timeout(FETCH_TIMEOUT_MS)])
    const response = await fetchImpl(current, {
      method,
      redirect: 'manual',
      signal: controller,
      headers: {
        'user-agent': userAgent,
        accept: 'application/json,image/*,text/plain,*/*;q=0.8',
      },
    })
    lastHeaders = response.headers
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location')
      if (!location) {
        return packProbe(url, current, method, response.status, lastHeaders, Buffer.alloc(0), redirectChain)
      }
      const next = new URL(location, current).href
      const hopSafety = inspectUrlSafety(next)
      if (!hopSafety.ok) throw new SsrfError(`Redirect blocked: ${hopSafety.reason}`)
      redirectChain.push(next)
      current = next
      continue
    }
    let body = Buffer.alloc(0)
    if (method !== 'HEAD') {
      const buf = Buffer.from(await response.arrayBuffer())
      body = buf.subarray(0, MAX_BODY)
    }
    return packProbe(url, current, method, response.status, lastHeaders, body, redirectChain)
  }
  return packProbe(url, current, method, 310, lastHeaders, Buffer.alloc(0), redirectChain)
}

function packProbe(
  url: string,
  finalUrl: string,
  method: 'GET' | 'HEAD',
  status: number,
  headers: Headers,
  body: Buffer,
  redirectChain: string[],
): { probe: ProbeResult; body: Buffer } {
  const contentType = headers.get('content-type') ?? ''
  return {
    body,
    probe: {
      url,
      finalUrl,
      method,
      status,
      contentType,
      mime: contentType.split(';')[0]?.trim() || '',
      headers: flattenHeaders(headers),
      cookies: cookieNames(headers),
      redirectChain,
      securityHeaders: securityHeaders(headers),
      server: headers.get('server') ?? '',
      size: body.length,
      depth: 0,
      source: 'email-osint',
    },
  }
}

function flattenHeaders(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {}
  headers.forEach((value, key) => {
    out[key] = out[key] ? `${out[key]}, ${value}` : value
  })
  return out
}

function securityHeaders(headers: Headers): SecurityHeaders {
  return {
    hsts: headers.get('strict-transport-security'),
    csp: headers.get('content-security-policy'),
    xfo: headers.get('x-frame-options'),
    xcto: headers.get('x-content-type-options'),
    xxss: headers.get('x-xss-protection'),
    referrerPolicy: headers.get('referrer-policy'),
    permissionsPolicy: headers.get('permissions-policy') ?? headers.get('feature-policy'),
  }
}

function cookieNames(headers: Headers): string[] {
  const raw = typeof headers.getSetCookie === 'function' ? headers.getSetCookie() : []
  return raw.map((c) => c.split(';')[0] ?? c)
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
