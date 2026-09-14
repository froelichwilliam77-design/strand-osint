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

export interface SecurityHeaders {
  hsts: string | null
  csp: string | null
  xfo: string | null
  xcto: string | null
  xxss: string | null
  referrerPolicy: string | null
  permissionsPolicy: string | null
}

export interface FormField {
  name: string
  type: string
  value: string
}

export interface FormResult {
  page: string
  action: string
  method: string
  fields: FormField[]
}

export interface SeedResult {
  url: string
  kind: 'robots' | 'sitemap' | 'manifest' | 'well-known' | 'html' | 'redirect'
  detail: string
}

export interface IntelResult {
  type: 'email' | 'phone'
  value: string
  source: string
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

export const DEFAULT_OPTIONS: SpiderOptions = {
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
}

export const WELL_KNOWN_PATHS = [
  '/robots.txt',
  '/sitemap.xml',
  '/manifest.webmanifest',
  '/manifest.json',
  '/humans.txt',
  '/favicon.ico',
  '/crossdomain.xml',
  '/.well-known/security.txt',
  '/.well-known/change-password',
  '/.well-known/assetlinks.json',
  '/.well-known/apple-app-site-association',
]
