import { createHash } from 'node:crypto'
import { promises as dns } from 'node:dns'
import { errMessage, isAbortError, probeHttp } from './http.ts'
import { parseEmailSeed as parseMailbox } from './phone.ts'
import { runEmailModules, runUsernameProbes, type OsintDeps } from './presence.ts'
import { inspectUrlSafety } from './ssrf.ts'
import type { IntelResult, SpiderEvent, SpiderOptions } from './types.ts'

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

const DISPOSABLE_DOMAINS = new Set([
  'mailinator.com',
  'guerrillamail.com',
  'guerrillamail.org',
  '10minutemail.com',
  'tempmail.com',
  'temp-mail.org',
  'yopmail.com',
  'trashmail.com',
  'discard.email',
  'getnada.com',
  'sharklasers.com',
])

export interface EmailParts {
  email: string
  local: string
  domain: string
}

export interface EmailOsintDeps extends OsintDeps {
  resolveMx?: (domain: string) => Promise<Array<{ exchange: string; priority: number }>>
}

export function parseEmailSeed(raw: string): string | null {
  return parseMailbox(raw)
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

export async function runEmailInvestigation(
  options: SpiderOptions,
  emit: (event: SpiderEvent) => void,
  signal: AbortSignal,
  deps: EmailOsintDeps = {},
): Promise<void> {
  const parts = splitEmail(options.target)
  const resolveMx = deps.resolveMx ?? ((domain: string) => dns.resolveMx(domain))
  const counters = { probed: 0, skipped: 0, intel: 0, registered: 0, notFound: 0, inconclusive: 0 }

  const stats = () => ({
    probed: counters.probed,
    forms: 0,
    scripts: 0,
    intel: counters.intel,
    queued: 0,
    skipped: counters.skipped,
  })

  const log = (level: 'info' | 'warn' | 'error' | 'skip', message: string) => {
    emit({ type: 'log', log: { ts: new Date().toISOString(), level, message } })
  }

  const pushIntel = (item: IntelResult) => {
    counters.intel += 1
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

  pushIntel({
    type: 'email',
    value: parts.email,
    source: 'seed',
    confidence: 'high',
    probed: false,
    evidence: 'Operator-supplied mailbox',
  })
  pushIntel({
    type: 'username',
    value: parts.local,
    source: 'email local-part',
    confidence: 'medium',
    evidence: 'Exact local-part; not proof of a matching handle',
  })
  const provider = MAILBOX_PROVIDERS[parts.domain]
  pushIntel({
    type: 'domain',
    value: parts.domain,
    source: provider ? `email domain · ${provider}` : 'email domain (custom / org mailbox likely)',
    confidence: 'high',
    evidence: provider ? 'Known consumer mailbox provider' : 'Not in the built-in consumer-provider list',
  })
  if (DISPOSABLE_DOMAINS.has(parts.domain)) {
    pushIntel({
      type: 'domain',
      value: parts.domain,
      source: 'disposable-mailbox indicator',
      confidence: 'high',
      evidence: 'Domain is on STRAND’s small public disposable-mail list',
    })
  }

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
        confidence: 'high',
        probed: true,
        evidence: 'Public DNS MX',
      })
    }
    if (mx.length) log('info', `MX for ${parts.domain}: ${mx.map((m) => m.exchange).join(', ')}`)
  } catch (err) {
    log('warn', `MX lookup failed for ${parts.domain}: ${errMessage(err)}`)
  }

  const hash = gravatarHash(parts.email)
  const avatarUrl = `https://www.gravatar.com/avatar/${hash}?d=404`
  try {
    emit({ type: 'status', status: 'running', stats: stats(), message: 'Checking Gravatar…' })
    const avatar = await probeHttp({
      url: avatarUrl,
      method: 'GET',
      userAgent: options.userAgent,
      signal,
      fetchImpl: deps.fetch,
      assertSafe: deps.assertSafe,
      source: 'email-osint',
    })
    counters.probed += 1
    emit({ type: 'probe', probe: avatar.probe })
    if (avatar.probe.status === 200) {
      pushIntel({
        type: 'account',
        value: 'Gravatar · registered',
        site: 'Gravatar',
        url: avatar.probe.finalUrl || avatarUrl,
        source: 'Gravatar avatar exists (public hash check)',
        confidence: 'high',
        probed: true,
        exists: true,
        evidence: 'Avatar endpoint returned 200 for MD5(email)',
      })
      log('info', `Gravatar avatar found for ${parts.email}`)
    } else if (avatar.probe.status === 404) {
      log('info', 'No public Gravatar avatar for this hash')
    } else {
      log('warn', `Gravatar avatar check returned ${avatar.probe.status}`)
    }
  } catch (err) {
    if (isAbortError(err) || signal.aborted) {
      emit({ type: 'status', status: 'stopped', stats: stats(), message: 'Stopped' })
      return
    }
    counters.skipped += 1
    log('warn', `Gravatar avatar check skipped: ${errMessage(err)}`)
  }

  const profileJsonUrl = `https://www.gravatar.com/${hash}.json`
  try {
    const profile = await probeHttp({
      url: profileJsonUrl,
      method: 'GET',
      userAgent: options.userAgent,
      signal,
      fetchImpl: deps.fetch,
      assertSafe: deps.assertSafe,
      source: 'email-osint',
    })
    counters.probed += 1
    emit({ type: 'probe', probe: profile.probe })
    if (profile.probe.status === 200 && profile.body.length) {
      parseGravatarJson(profile.body.toString('utf8'), pushIntel, log)
    } else if (profile.probe.status === 404) {
      log('info', 'No public Gravatar profile JSON for this hash')
    }
  } catch (err) {
    if (isAbortError(err) || signal.aborted) {
      emit({ type: 'status', status: 'stopped', stats: stats(), message: 'Stopped' })
      return
    }
    counters.skipped += 1
    log('warn', `Gravatar profile check skipped: ${errMessage(err)}`)
  }

  try {
    await runEmailModules(parts.email, options, emit, signal, deps, counters)
  } catch (err) {
    if (isAbortError(err) || signal.aborted) {
      emit({ type: 'status', status: 'stopped', stats: stats(), message: 'Stopped' })
      log('warn', 'Email investigation stopped')
      return
    }
    log('warn', `Site checks stopped early: ${errMessage(err)}`)
  }

  const usernames = deriveUsernames(parts.local)
  const probeHandle = usernames[0] ?? parts.local
  for (const username of usernames) {
    if (username.toLowerCase() === parts.local.toLowerCase()) continue
    pushIntel({
      type: 'username',
      value: username,
      source: 'derived from local-part',
      confidence: 'unverified',
      probed: false,
      evidence: 'Heuristic variant of the mailbox local-part — not a finding unless a probe hits',
    })
  }

  log('info', `Probing public profiles for handle "${probeHandle}" (derived from local-part; hits only if the page exists)`)
  try {
    await runUsernameProbes(probeHandle, options, emit, signal, deps, counters, `email local-part "${probeHandle}"`)
  } catch (err) {
    if (isAbortError(err) || signal.aborted) {
      emit({ type: 'status', status: 'stopped', stats: stats(), message: 'Stopped' })
      log('warn', 'Email investigation stopped')
      return
    }
    log('warn', `Username probes stopped early: ${errMessage(err)}`)
  }

  if (!provider) {
    const homepage = `https://${parts.domain}/`
    const safety = inspectUrlSafety(homepage)
    if (!safety.ok) {
      log('skip', `Domain homepage probe blocked: ${safety.reason}`)
    } else {
      try {
        const home = await probeHttp({
          url: homepage,
          method: 'HEAD',
          userAgent: options.userAgent,
          signal,
          fetchImpl: deps.fetch,
          assertSafe: deps.assertSafe,
          source: 'email-osint',
        })
        counters.probed += 1
        emit({ type: 'probe', probe: home.probe })
        pushIntel({
          type: 'site',
          value: home.probe.finalUrl || homepage,
          source: `custom-domain homepage (${home.probe.status})`,
          confidence: 'medium',
          probed: true,
          exists: home.probe.status > 0 && home.probe.status < 500,
          evidence: `HEAD ${home.probe.status}`,
        })
      } catch (err) {
        if (isAbortError(err) || signal.aborted) {
          emit({ type: 'status', status: 'stopped', stats: stats(), message: 'Stopped' })
          return
        }
        counters.skipped += 1
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
    `Done — email OSINT ${counters.probed} HTTP checks, ${counters.intel} intel (${counters.registered} registered site hits)`,
  )
  emit({ type: 'status', status: 'done', stats: stats(), message: `Complete — ${counters.intel} intel (email OSINT)` })
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
      pushIntel({
        type: 'username',
        value: entry.displayName,
        source: 'Gravatar public profile display name',
        confidence: 'high',
        probed: true,
        exists: true,
      })
    }
    if (entry.preferredUsername) {
      pushIntel({
        type: 'username',
        value: entry.preferredUsername,
        source: 'Gravatar preferred username',
        confidence: 'high',
        probed: true,
        exists: true,
      })
    }
    if (entry.profileUrl) {
      pushIntel({
        type: 'site',
        value: entry.profileUrl,
        source: 'Gravatar public profile URL',
        confidence: 'high',
        probed: true,
        exists: true,
        url: entry.profileUrl,
      })
    }
    for (const account of entry.accounts ?? []) {
      if (!account.url) continue
      const tag = account.verified ? 'verified' : 'listed'
      pushIntel({
        type: 'account',
        value: `${account.shortname || account.domain || 'site'} · ${tag}`,
        site: account.shortname || account.domain || 'Gravatar account',
        url: account.url,
        source: `Gravatar public profile ${tag} account`,
        confidence: account.verified ? 'high' : 'medium',
        probed: true,
        exists: true,
      })
    }
    for (const extra of entry.urls ?? []) {
      if (!extra.value) continue
      pushIntel({
        type: 'site',
        value: extra.value,
        source: extra.title ? `Gravatar profile link (${extra.title})` : 'Gravatar profile link',
        confidence: 'medium',
        probed: true,
        url: extra.value,
      })
    }
  } catch {
    log('warn', 'Gravatar profile JSON was not parseable')
  }
}
