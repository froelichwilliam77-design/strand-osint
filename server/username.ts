import { errMessage, isAbortError } from './http.ts'
import { runUsernameProbes, type OsintDeps } from './presence.ts'
import type { IntelResult, SpiderEvent, SpiderOptions } from './types.ts'

export async function runUsernameInvestigation(
  options: SpiderOptions,
  emit: (event: SpiderEvent) => void,
  signal: AbortSignal,
  deps: OsintDeps = {},
): Promise<void> {
  const username = options.target.replace(/^@/, '').trim()
  if (!username) throw new Error('Not a username seed')
  const counters = { probed: 0, skipped: 0, intel: 0 }
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
  const push = (item: IntelResult) => {
    counters.intel += 1
    emit({ type: 'intel', intel: item })
  }

  log('info', `Username presence checks for "${username}" (public profile URLs only; no DMs)`)
  emit({ type: 'seed', seed: { url: `https://github.com/${encodeURIComponent(username)}`, kind: 'username', detail: 'username seed' } })
  emit({ type: 'status', status: 'running', stats: stats(), message: 'Username investigation' })
  push({
    type: 'username',
    value: username,
    source: 'seed',
    confidence: 'high',
    evidence: 'Operator-supplied handle',
  })

  try {
    await runUsernameProbes(username, options, emit, signal, deps, counters, 'username seed')
  } catch (err) {
    if (isAbortError(err) || signal.aborted) {
      emit({ type: 'status', status: 'stopped', stats: stats(), message: 'Stopped' })
      log('warn', 'Username investigation stopped')
      return
    }
    log('warn', `Username probes stopped early: ${errMessage(err)}`)
  }

  if (signal.aborted) {
    emit({ type: 'status', status: 'stopped', stats: stats(), message: 'Stopped' })
    log('warn', 'Username investigation stopped')
    return
  }

  log('info', `Done — username OSINT ${counters.probed} HTTP checks, ${counters.intel} intel`)
  emit({ type: 'status', status: 'done', stats: stats(), message: `Complete — ${counters.intel} intel (username OSINT)` })
}
