import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export type SpiderMode = 'semi-passive' | 'active'
export type SpiderScope = 'same-host' | 'path-prefix'
export type SeedKind = 'url' | 'email' | 'username' | 'phone' | 'unknown'

export interface SpiderOptions {
  target: string
  mode: SpiderMode
  scope: SpiderScope
  depth: number
  maxPages: number
  workers: number
  delayMs: number
  userAgent: string
  respectRobots: boolean
  followSitemaps: boolean
  wellKnownSeeds: boolean
  parseJsUrls: boolean
}

export interface SecurityHeaders {
  hsts: string | null
  csp: string | null
  xfo: string | null
  xcto: string | null
  xxss: string | null
  referrerPolicy: string | null
  permissionsPolicy: string | null
}

export interface ProbeResult {
  url: string
  finalUrl: string
  method: 'GET' | 'HEAD' | 'POST'
  status: number
  contentType: string
  mime: string
  headers: Record<string, string>
  cookies: string[]
  redirectChain: string[]
  securityHeaders: SecurityHeaders
  server: string
  size: number
  depth: number
  source: string
  skipped?: string
}

export interface FormResult {
  page: string
  action: string
  method: string
  fields: { name: string; type: string; value: string }[]
}

export interface SeedResult {
  url: string
  kind: string
  detail: string
}

export type IntelType = 'email' | 'phone' | 'site' | 'username' | 'domain' | 'mx' | 'account'
export type IntelConfidence = 'high' | 'medium' | 'low' | 'unverified'

export interface IntelResult {
  type: IntelType
  value: string
  source: string
  confidence?: IntelConfidence
  site?: string
  url?: string
  evidence?: string
  probed?: boolean
  exists?: boolean | null
}

const EMAIL_SEED_RE = /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i
const USERNAME_RE = /^@?[A-Za-z0-9](?:[A-Za-z0-9._-]{0,37}[A-Za-z0-9])?$/
const HOST_LIKE_RE = /^(?:[A-Za-z0-9-]+\.)+[A-Za-z]{2,}(?:[/:?#].*)?$/

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

export function peekSeedKind(raw: string): SeedKind {
  const trimmed = raw.trim()
  if (!trimmed) return 'unknown'
  if (/^https?:\/\//i.test(trimmed)) return 'url'
  if (parseEmailSeed(trimmed)) return 'email'
  const digits = trimmed.replace(/\D/g, '')
  if (digits.length >= 8 && digits.length <= 15 && /^\+?[0-9][0-9().\s-]{6,22}$/.test(trimmed) && !/[A-Za-z]/.test(trimmed)) {
    return 'phone'
  }
  const handle = trimmed.replace(/^@/, '')
  if ((trimmed.startsWith('@') || USERNAME_RE.test(trimmed)) && handle && !HOST_LIKE_RE.test(handle) && !/^[\d._-]+$/.test(handle)) {
    return 'username'
  }
  if (HOST_LIKE_RE.test(trimmed) && !/\s/.test(trimmed)) return 'url'
  if (USERNAME_RE.test(handle) && !/^[\d._-]+$/.test(handle)) return 'username'
  return 'unknown'
}

export function isPrimaryIntel(item: IntelResult): boolean {
  if (item.confidence === 'unverified' || item.confidence === 'low') return false
  if (item.exists === false || item.exists === null) return false
  if (item.exists === true) return true
  if (item.confidence === 'high' || item.confidence === 'medium') return true
  if (item.probed) return true
  return !item.confidence
}

/** Lower is better. Confirmed registrations first; weak/inconclusive last. */
export function intelRank(item: IntelResult): number {
  if (item.exists === true) return 0
  if (item.site === 'Presence') return 1
  if (item.confidence === 'high') return 2
  if (item.confidence === 'medium') return 3
  if (item.confidence === 'low' || item.exists === null) return 4
  if (item.confidence === 'unverified') return 5
  return 3
}

export function sortIntel(items: IntelResult[]): IntelResult[] {
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => intelRank(a.item) - intelRank(b.item) || a.index - b.index)
    .map((entry) => entry.item)
}

export interface LogEvent {
  ts: string
  level: 'info' | 'warn' | 'error' | 'skip'
  message: string
}

export interface SpiderStats {
  probed: number
  forms: number
  scripts: number
  intel: number
  queued: number
  skipped: number
}

export type SpiderEvent =
  | { type: 'log'; log: LogEvent }
  | { type: 'probe'; probe: ProbeResult }
  | { type: 'form'; form: FormResult }
  | { type: 'seed'; seed: SeedResult }
  | { type: 'intel'; intel: IntelResult }
  | { type: 'script'; url: string }
  | { type: 'status'; status: 'running' | 'done' | 'stopped' | 'error'; stats: SpiderStats; message?: string }
  | { type: 'error'; message: string }

export const NORTHLINE_TARGET = 'https://northline.sample/'

export const defaultOptions = (): SpiderOptions => ({
  target: 'https://example.com',
  mode: 'semi-passive',
  scope: 'same-host',
  depth: 3,
  maxPages: 60,
  workers: 3,
  delayMs: 150,
  userAgent: 'Strand spider',
  respectRobots: true,
  followSitemaps: true,
  wellKnownSeeds: true,
  parseJsUrls: true,
})
