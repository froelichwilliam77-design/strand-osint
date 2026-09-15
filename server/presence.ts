import { HOLEHE_EMAIL_MODULES } from './email-modules.ts'
import { errMessage, isAbortError, probeHttp, sleep } from './http.ts'
import type { IntelConfidence, IntelResult, SpiderEvent, SpiderOptions } from './types.ts'
import { USERNAME_SITES } from './username-sites.ts'

export interface OsintDeps {
  fetch?: typeof fetch
  assertSafe?: (url: string) => Promise<URL>
}

export interface PresenceOutcome {
  exists: boolean | null
  evidence: string
  extra?: string
  rateLimited?: boolean
  confidence?: IntelConfidence
}

export interface EmailModule {
  id: string
  name: string
  domain: string
  method: 'register' | 'login' | 'other'
  request: (email: string) => {
    url: string
    method: 'GET' | 'POST' | 'HEAD'
    headers?: Record<string, string>
    body?: string
    followRedirects?: boolean
  }
  interpret: (
    status: number,
    body: string,
    ctx?: { finalUrl: string; headers: Record<string, string> },
  ) => PresenceOutcome
}

export interface UsernameSite {
  id: string
  name: string
  url: (username: string) => string
  profileUrl?: (username: string) => string
  method?: 'GET' | 'POST'
  headers?: Record<string, string>
  body?: (username: string) => string
  interpret: (status: number, body: string, finalUrl: string) => PresenceOutcome
}

export { EMAIL_MODULES, HOLEHE_EMAIL_MODULES } from './email-modules.ts'
export {
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
} from './email-modules.ts'
export { USERNAME_SITES } from './username-sites.ts'

export interface PresenceCounters {
  probed: number
  skipped: number
  intel: number
  registered: number
  notFound: number
  inconclusive: number
}

function presenceWorkers(workers: number): number {
  return Math.max(1, Math.min(6, workers))
}

function emitStatus(
  emit: (event: SpiderEvent) => void,
  counters: PresenceCounters,
  message: string,
) {
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
    message,
  })
}

export async function runEmailModules(
  email: string,
  options: SpiderOptions,
  emit: (event: SpiderEvent) => void,
  signal: AbortSignal,
  deps: OsintDeps,
  counters: PresenceCounters,
): Promise<void> {
  const modules = HOLEHE_EMAIL_MODULES
  const limit = presenceWorkers(options.workers)
  emit({
    type: 'log',
    log: {
      ts: new Date().toISOString(),
      level: 'info',
      message: `Holehe-style site checks: ${modules.length} register/login/public APIs (never password-reset or SMTP)`,
    },
  })
  await runPool(modules, limit, signal, options.delayMs, async (mod) => {
    emitStatus(emit, counters, `Checking ${mod.name}…`)
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
        followRedirects: req.followRedirects,
        source: `email-check:${mod.id}`,
      })
      counters.probed += 1
      emit({ type: 'probe', probe: result.probe })
      const outcome = mod.interpret(result.probe.status, result.body.toString('utf8'), {
        finalUrl: result.probe.finalUrl,
        headers: result.probe.headers,
      })
      emitAccountIntel(emit, counters, mod.name, req.url, outcome, `holehe-style ${mod.method} check`)
    } catch (err) {
      if (isAbortError(err) || signal.aborted) throw err
      counters.skipped += 1
      emit({
        type: 'log',
        log: { ts: new Date().toISOString(), level: 'warn', message: `${mod.name} check skipped: ${errMessage(err)}` },
      })
    }
  })
  emitSweepSummary(emit, counters, 'email')
}

export async function runUsernameProbes(
  username: string,
  options: SpiderOptions,
  emit: (event: SpiderEvent) => void,
  signal: AbortSignal,
  deps: OsintDeps,
  counters: PresenceCounters,
  sourceLabel = 'username probe',
): Promise<void> {
  const limit = presenceWorkers(options.workers)
  emit({
    type: 'log',
    log: {
      ts: new Date().toISOString(),
      level: 'info',
      message: `Public profile probes: ${USERNAME_SITES.length} networks (exists heuristics; generic 200 is not a hit)`,
    },
  })
  await runPool(USERNAME_SITES, limit, signal, options.delayMs, async (site) => {
    emitStatus(emit, counters, `Probing ${site.name}…`)
    const url = site.url(username)
    const displayUrl = site.profileUrl?.(username) ?? url
    try {
      const result = await probeHttp({
        url,
        method: site.method ?? 'GET',
        userAgent: options.userAgent,
        signal,
        fetchImpl: deps.fetch,
        assertSafe: deps.assertSafe,
        headers: site.headers,
        body: site.body?.(username),
        source: sourceLabel,
      })
      counters.probed += 1
      emit({ type: 'probe', probe: result.probe })
      const outcome = site.interpret(result.probe.status, result.body.toString('utf8'), result.probe.finalUrl)
      emitAccountIntel(
        emit,
        counters,
        site.name,
        result.probe.finalUrl || displayUrl,
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
  emitSweepSummary(emit, counters, 'username')
}

function emitAccountIntel(
  emit: (event: SpiderEvent) => void,
  counters: PresenceCounters,
  site: string,
  url: string,
  outcome: PresenceOutcome,
  source: string,
) {
  if (outcome.rateLimited) {
    counters.inconclusive += 1
    emit({
      type: 'log',
      log: { ts: new Date().toISOString(), level: 'warn', message: `${site}: ${outcome.evidence}` },
    })
    return
  }
  if (outcome.exists === true) {
    counters.registered += 1
    counters.intel += 1
    const intel: IntelResult = {
      type: 'account',
      value: `${site} · registered`,
      site,
      url,
      source,
      confidence: outcome.confidence ?? 'high',
      probed: true,
      exists: true,
      evidence: outcome.evidence,
    }
    emit({ type: 'intel', intel })
    emit({
      type: 'log',
      log: { ts: new Date().toISOString(), level: 'info', message: `${site}: registered (${outcome.evidence})` },
    })
    if (outcome.extra) {
      counters.intel += 1
      emit({
        type: 'intel',
        intel: {
          type: 'username',
          value: outcome.extra,
          site,
          url,
          source: `${site} linked handle`,
          confidence: 'high',
          probed: true,
          exists: true,
          evidence: `Returned with ${site} registration hit`,
        },
      })
    }
    return
  }
  if (outcome.exists === false) {
    counters.notFound += 1
    emit({
      type: 'log',
      log: { ts: new Date().toISOString(), level: 'info', message: `${site}: not registered (${outcome.evidence})` },
    })
    return
  }
  counters.inconclusive += 1
  counters.intel += 1
  emit({
    type: 'intel',
    intel: {
      type: 'account',
      value: `${site} · inconclusive`,
      site,
      url,
      source,
      confidence: 'low',
      probed: true,
      exists: null,
      evidence: outcome.evidence,
    },
  })
  emit({
    type: 'log',
    log: { ts: new Date().toISOString(), level: 'warn', message: `${site}: inconclusive (${outcome.evidence})` },
  })
}

function emitSweepSummary(
  emit: (event: SpiderEvent) => void,
  counters: PresenceCounters,
  kind: 'email' | 'username',
) {
  const checked = counters.registered + counters.notFound + counters.inconclusive
  if (!checked) return
  counters.intel += 1
  emit({
    type: 'intel',
    intel: {
      type: 'account',
      value: `${counters.registered} registered · ${counters.notFound} not found · ${counters.inconclusive} inconclusive`,
      site: 'Presence',
      source: `${kind} presence sweep`,
      confidence: 'high',
      probed: true,
      evidence: `Checked ${checked} sites (register/login/public profile; never password-reset or SMTP)`,
    },
  })
  emit({
    type: 'log',
    log: {
      ts: new Date().toISOString(),
      level: 'info',
      message: `Presence sweep: ${counters.registered} registered, ${counters.notFound} not found, ${counters.inconclusive} inconclusive (${checked} sites)`,
    },
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
      if (delayMs > 0) {
        const jitter = Math.floor(Math.random() * Math.min(80, delayMs))
        await sleep(delayMs + jitter, signal)
      }
      await fn(item)
    }
  })
  await Promise.all(workers)
  if (signal.aborted) throw new Error('aborted')
}
