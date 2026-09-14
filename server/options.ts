import { classifySeed } from './seed.ts'
import { SsrfError, inspectUrlSafety } from './ssrf.ts'
import { DEFAULT_OPTIONS, type SpiderOptions } from './types.ts'

export function parseOptions(body: unknown): SpiderOptions {
  const raw = (body ?? {}) as Partial<SpiderOptions>
  const target = String(raw.target ?? '').trim()
  if (!target) throw new Error('Target is required — paste a URL, email, @username, or phone number.')

  const seed = classifySeed(target)
  if (seed.kind === 'unknown' || !seed.value) {
    throw new TypeError('Could not parse target. Paste a URL (https://…), email, @username, or phone number.')
  }

  if (seed.kind === 'url') {
    const safety = inspectUrlSafety(seed.value)
    if (!safety.ok) throw new SsrfError(safety.reason)
  }

  return {
    ...baseOptions(raw),
    target: seed.value,
  }
}

function baseOptions(raw: Partial<SpiderOptions>): Omit<SpiderOptions, 'target'> {
  return {
    mode: raw.mode === 'active' ? 'active' : 'semi-passive',
    scope: raw.scope === 'path-prefix' ? 'path-prefix' : 'same-host',
    depth: clamp(Number(raw.depth ?? DEFAULT_OPTIONS.depth), 1, 8),
    maxPages: clamp(Number(raw.maxPages ?? DEFAULT_OPTIONS.maxPages), 1, 250),
    workers: clamp(Number(raw.workers ?? DEFAULT_OPTIONS.workers), 1, 8),
    delayMs: clamp(Number(raw.delayMs ?? DEFAULT_OPTIONS.delayMs), 0, 5000),
    userAgent: String(raw.userAgent || DEFAULT_OPTIONS.userAgent).slice(0, 180),
    respectRobots: raw.respectRobots !== false,
    followSitemaps: raw.followSitemaps !== false,
    wellKnownSeeds: raw.wellKnownSeeds !== false,
    parseJsUrls: raw.parseJsUrls !== false,
  }
}

function clamp(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min
  return Math.min(max, Math.max(min, Math.round(n)))
}
