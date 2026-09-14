import { assertSafeUrl, inspectUrlSafety, SsrfError } from './ssrf.ts'
import type { ProbeResult, SecurityHeaders } from './types.ts'

const FETCH_TIMEOUT_MS = 10_000
const MAX_REDIRECTS = 8
const MAX_BODY = 400_000

export interface ProbeHttpOptions {
  url: string
  method?: 'GET' | 'HEAD' | 'POST'
  userAgent: string
  signal: AbortSignal
  fetchImpl?: typeof fetch
  assertSafe?: (url: string) => Promise<URL>
  headers?: Record<string, string>
  body?: string
  source?: string
}

export async function probeHttp(opts: ProbeHttpOptions): Promise<{ probe: ProbeResult; body: Buffer }> {
  const method = opts.method ?? 'GET'
  const fetchImpl = opts.fetchImpl ?? fetch
  const assertSafe = opts.assertSafe ?? assertSafeUrl
  let current = opts.url
  const redirectChain: string[] = []
  let lastHeaders = new Headers()
  for (let i = 0; i < MAX_REDIRECTS; i += 1) {
    if (opts.signal.aborted) throw new Error('aborted')
    await assertSafe(current)
    const controller = AbortSignal.any([opts.signal, AbortSignal.timeout(FETCH_TIMEOUT_MS)])
    const response = await fetchImpl(current, {
      method,
      redirect: 'manual',
      signal: controller,
      headers: {
        'user-agent': opts.userAgent,
        accept: 'application/json,text/html,text/plain,image/*,*/*;q=0.8',
        ...opts.headers,
      },
      body: method === 'POST' ? opts.body : undefined,
    })
    lastHeaders = response.headers
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location')
      if (!location) {
        return packProbe(opts.url, current, method, response.status, lastHeaders, Buffer.alloc(0), redirectChain, opts.source)
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
    return packProbe(opts.url, current, method, response.status, lastHeaders, body, redirectChain, opts.source)
  }
  return packProbe(opts.url, current, method, 310, lastHeaders, Buffer.alloc(0), redirectChain, opts.source)
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms)
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(t)
        reject(new Error('aborted'))
      },
      { once: true },
    )
  })
}

export function isAbortError(err: unknown): boolean {
  if (!err) return false
  if (err instanceof Error) {
    if (err.name === 'AbortError') return true
    if (/^aborted$/i.test(err.message) || /aborted/i.test(err.message) && err.message.length < 24) return true
  }
  return false
}

export function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function packProbe(
  url: string,
  finalUrl: string,
  method: 'GET' | 'HEAD' | 'POST',
  status: number,
  headers: Headers,
  body: Buffer,
  redirectChain: string[],
  source?: string,
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
      source: source ?? 'osint',
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
