import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export type SpiderMode = 'semi-passive' | 'active'
export type SpiderScope = 'same-host' | 'path-prefix'

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
  method: 'GET' | 'HEAD'
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

export type IntelType = 'email' | 'phone' | 'site' | 'username' | 'domain' | 'mx'

export interface IntelResult {
  type: IntelType
  value: string
  source: string
}

const EMAIL_SEED_RE = /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i

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
