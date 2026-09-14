import robotsParser from 'robots-parser'
import { assertSafeUrl, inspectUrlSafety, isNorthlineHost, SsrfError } from './ssrf.ts'
import { serveNorthline } from './northline.ts'
import {
  extractFromCss,
  extractFromHtml,
  extractFromJs,
  extractFromJson,
  extractFromText,
  parseSitemapXml,
  resolveUrl,
  type Extraction,
} from './extract.ts'
import { isEmailSeed } from './email.ts'
import { WELL_KNOWN_PATHS, type ProbeResult, type SecurityHeaders, type SpiderEvent, type SpiderOptions } from './types.ts'

const BINARY_EXT =
  /\.(?:pdf|zip|png|jpe?g|gif|webp|ico|svg|woff2?|ttf|eot|mp4|mp3|gz|tgz|exe|dmg|bin|wasm)(?:$|\?)/i
const TEXT_TYPES = /html|xml|json|javascript|ecmascript|css|text\/plain|svg|manifest|urlencoded/i
const MAX_BODY = 1_500_000
const MAX_REDIRECTS = 8
const FETCH_TIMEOUT_MS = 12_000

interface QueueItem {
  url: string
  depth: number
  source: string
}

export async function runSpider(
  options: SpiderOptions,
  emit: (event: SpiderEvent) => void,
  signal: AbortSignal,
): Promise<void> {
  if (isEmailSeed(options.target)) {
    throw new Error('Email seeds must use email investigation, not URL crawl')
  }
  const target = new URL(options.target)
  const safety = inspectUrlSafety(target.href)
  if (!safety.ok) throw new SsrfError(safety.reason)
  if (!isNorthlineHost(target.hostname)) {
    await assertSafeUrl(target.href)
  }

  const origin = target.origin
  const prefix = target.pathname.endsWith('/') ? target.pathname : `${target.pathname.replace(/\/[^/]*$/, '')}/`
  const seen = new Set<string>()
  const queue: QueueItem[] = []
  const inFlight = new Set<string>()
  const scripts = new Set<string>()
  let robots = robotsParser(new URL('/robots.txt', origin).href, '')
  let robotsReady = !options.respectRobots
  let probed = 0
  let skipped = 0
  let forms = 0
  let intel = 0
  let sitemapBudget = 12

  const stats = () => ({
    probed,
    forms,
    scripts: scripts.size,
    intel,
    queued: queue.length,
    skipped,
  })

  const log = (level: 'info' | 'warn' | 'error' | 'skip', message: string) => {
    emit({ type: 'log', log: { ts: new Date().toISOString(), level, message } })
  }

  const enqueue = (raw: string, depth: number, source: string) => {
    const abs = resolveUrl(raw, origin)
    if (!abs) return
    const normalized = normalize(abs)
    if (seen.has(normalized)) return
    if (depth > options.depth) return
    if (!inScope(normalized, target, options.scope, prefix)) return
    seen.add(normalized)
    queue.push({ url: normalized, depth, source })
    if (source.includes('sitemap') || source.includes('robots') || source.includes('well-known') || source.includes('manifest')) {
      emit({ type: 'seed', seed: { url: normalized, kind: seedKind(source), detail: source } })
    }
  }

  enqueue(target.href, 0, 'target')
  if (options.wellKnownSeeds) {
    for (const path of WELL_KNOWN_PATHS) enqueue(new URL(path, origin).href, 0, 'well-known')
  }
  if (options.followSitemaps) enqueue(new URL('/sitemap.xml', origin).href, 0, 'sitemap')

  log('info', `Seeded ${queue.length} URLs from ${target.href}`)
  emit({ type: 'status', status: 'running', stats: stats(), message: 'Fetching seeds' })

  if (options.respectRobots) {
    try {
      const robotsUrl = new URL('/robots.txt', origin).href
      const fetched = await fetchResource(robotsUrl, 'GET', options.userAgent, signal)
      robots = robotsParser(robotsUrl, fetched.body.toString('utf8'))
      robotsReady = true
      log('info', `Loaded robots.txt (${fetched.status})`)
      for (const sm of robots.getSitemaps()) {
        if (options.followSitemaps) enqueue(sm, 0, 'robots[sitemap]')
      }
    } catch (err) {
      robotsReady = true
      log('warn', `robots.txt unavailable (${errMessage(err)}); treating as allow-all`)
    }
  }

  const worker = async () => {
    while (!signal.aborted) {
      if (probed >= options.maxPages) return
      const item = queue.shift()
      if (!item) {
        if (inFlight.size === 0) return
        await sleep(15)
        continue
      }
      if (probed >= options.maxPages) return
      if (robotsReady && options.respectRobots && robots.isAllowed(item.url, options.userAgent) === false) {
        skipped += 1
        log('skip', `robots.txt disallows ${item.url}`)
        emit({
          type: 'probe',
          probe: skippedProbe(item, 'robots.txt'),
        })
        continue
      }
      inFlight.add(item.url)
      try {
        if (options.delayMs > 0) await sleep(options.delayMs, signal)
        await probe(item)
      } catch (err) {
        if (signal.aborted) return
        log('error', `${item.url}: ${errMessage(err)}`)
      } finally {
        inFlight.delete(item.url)
      }
    }
  }

  const probe = async (item: QueueItem) => {
    const method: 'GET' | 'HEAD' = options.mode === 'semi-passive' && BINARY_EXT.test(item.url) ? 'HEAD' : 'GET'
    const fetched = await fetchResource(item.url, method, options.userAgent, signal)
    probed += 1
    const contentType = header(fetched.headers, 'content-type')
    const mime = contentType.split(';')[0]?.trim() || guessMime(item.url)
    const probeResult: ProbeResult = {
      url: item.url,
      finalUrl: fetched.finalUrl,
      method,
      status: fetched.status,
      contentType,
      mime,
      headers: flattenHeaders(fetched.headers),
      cookies: fetched.cookies,
      redirectChain: fetched.redirectChain,
      securityHeaders: securityHeaders(fetched.headers),
      server: header(fetched.headers, 'server'),
      size: fetched.body.length,
      depth: item.depth,
      source: item.source,
    }
    emit({ type: 'probe', probe: probeResult })
    emit({ type: 'status', status: 'running', stats: stats() })
    log('info', `${method} ${item.url} → ${fetched.status} ${mime || 'unknown'} (${item.source})`)

    if (method === 'HEAD' || fetched.status >= 400) return
    if (!fetched.body.length) return
    if (!TEXT_TYPES.test(mime) && BINARY_EXT.test(item.url)) return

    const body = fetched.body.toString('utf8')
    const base = fetched.finalUrl || item.url
    let extracted: Extraction = { links: [], forms: [], emails: [], phones: [], scripts: [] }

    if (item.url.endsWith('/robots.txt') || mime === 'text/plain' && item.url.includes('robots.txt')) {
      try {
        const parsed = robotsParser(item.url, body)
        for (const sm of parsed.getSitemaps()) enqueue(sm, item.depth, 'robots[sitemap]')
      } catch {
        /* ignore */
      }
      extracted = extractFromText(body, base)
      emit({ type: 'seed', seed: { url: item.url, kind: 'robots', detail: 'robots.txt' } })
    } else if (mime.includes('xml') || /sitemap/i.test(item.url)) {
      const map = parseSitemapXml(body)
      if (options.followSitemaps && sitemapBudget > 0) {
        for (const sm of map.sitemaps) {
          sitemapBudget -= 1
          enqueue(sm, item.depth, 'sitemap[index]')
        }
        for (const loc of map.urls) enqueue(loc, Math.min(item.depth + 1, options.depth), 'sitemap[loc]')
      }
      extracted = extractFromText(body, base)
      if (map.sitemaps.length || map.urls.length) {
        emit({ type: 'seed', seed: { url: item.url, kind: 'sitemap', detail: `${map.urls.length} urls, ${map.sitemaps.length} nested` } })
      }
    } else if (mime.includes('json') || mime.includes('manifest') || item.url.endsWith('.webmanifest')) {
      extracted = extractFromJson(body, base)
      if (/manifest/i.test(item.url) || mime.includes('manifest')) {
        emit({ type: 'seed', seed: { url: item.url, kind: 'manifest', detail: 'web app manifest' } })
      }
    } else if (mime.includes('javascript') || mime.includes('ecmascript') || item.url.endsWith('.js')) {
      scripts.add(normalize(item.url))
      emit({ type: 'script', url: item.url })
      extracted = options.parseJsUrls ? extractFromJs(body, base) : extractFromText(body, base)
    } else if (mime.includes('css')) {
      extracted = extractFromCss(body, base)
    } else if (mime.includes('html') || mime.includes('xml') || mime.includes('svg')) {
      extracted = extractFromHtml(body, base, options.parseJsUrls)
    } else {
      extracted = extractFromText(body, base)
    }

    for (const form of extracted.forms) {
      forms += 1
      emit({ type: 'form', form })
    }
    for (const script of extracted.scripts) {
      scripts.add(normalize(script))
      emit({ type: 'script', url: script })
    }
    for (const email of extracted.emails) {
      intel += 1
      emit({ type: 'intel', intel: { type: 'email', value: email.value, source: email.source } })
    }
    for (const phone of extracted.phones) {
      intel += 1
      emit({ type: 'intel', intel: { type: 'phone', value: phone.value, source: phone.source } })
    }
    for (const link of extracted.links) {
      enqueue(link.url, item.depth + 1, link.source)
    }
    emit({ type: 'status', status: 'running', stats: stats() })
  }

  const workers = Math.max(1, Math.min(8, options.workers))
  await Promise.all(Array.from({ length: workers }, () => worker()))
  if (signal.aborted) {
    emit({ type: 'status', status: 'stopped', stats: stats(), message: 'Stopped' })
    log('warn', 'Crawl stopped')
    return
  }
  log('info', `Done — ${probed} probed, ${forms} forms, ${scripts.size} scripts, ${intel} intel, ${skipped} skipped`)
  emit({ type: 'status', status: 'done', stats: stats(), message: `Complete — ${probed} URLs` })
}

interface Fetched {
  status: number
  headers: Headers
  body: Buffer
  cookies: string[]
  redirectChain: string[]
  finalUrl: string
}

async function fetchResource(url: string, method: 'GET' | 'HEAD', userAgent: string, signal: AbortSignal): Promise<Fetched> {
  let current = url
  const redirectChain: string[] = []
  const cookies: string[] = []
  let lastHeaders = new Headers()
  for (let i = 0; i < MAX_REDIRECTS; i += 1) {
    if (signal.aborted) throw new Error('aborted')
    const parsed = new URL(current)
    if (isNorthlineHost(parsed.hostname)) {
      const res = serveNorthline(parsed)
      const headers = headersFromRecord(res.headers)
      cookies.push(...cookieNames(headers))
      lastHeaders = headers
      if (res.redirectTo && res.status >= 300 && res.status < 400) {
        const next = new URL(res.redirectTo, current).href
        redirectChain.push(next)
        current = next
        continue
      }
      return {
        status: res.status,
        headers,
        body: method === 'HEAD' ? Buffer.alloc(0) : res.body,
        cookies,
        redirectChain,
        finalUrl: current,
      }
    }

    await assertSafeUrl(current)
    const controller = AbortSignal.any([signal, AbortSignal.timeout(FETCH_TIMEOUT_MS)])
    const response = await fetch(current, {
      method,
      redirect: 'manual',
      signal: controller,
      headers: {
        'user-agent': userAgent,
        accept: 'text/html,application/xhtml+xml,application/xml,application/json,text/css,application/javascript,*/*;q=0.8',
      },
    })
    lastHeaders = response.headers
    cookies.push(...cookieNames(response.headers))
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location')
      if (!location) {
        return finishHttp(response, method, cookies, redirectChain, current)
      }
      const next = new URL(location, current).href
      const hopSafety = inspectUrlSafety(next)
      if (!hopSafety.ok) throw new SsrfError(`Redirect blocked: ${hopSafety.reason}`)
      redirectChain.push(next)
      current = next
      continue
    }
    return finishHttp(response, method, cookies, redirectChain, current)
  }
  return {
    status: 310,
    headers: lastHeaders,
    body: Buffer.alloc(0),
    cookies,
    redirectChain,
    finalUrl: current,
  }
}

async function finishHttp(response: Response, method: 'GET' | 'HEAD', cookies: string[], redirectChain: string[], finalUrl: string): Promise<Fetched> {
  const length = Number(response.headers.get('content-length') ?? '0')
  let body = Buffer.alloc(0)
  if (method !== 'HEAD') {
    if (length > MAX_BODY) {
      body = Buffer.alloc(0)
    } else {
      body = Buffer.from(await readCapped(response))
    }
  }
  return { status: response.status, headers: response.headers, body, cookies, redirectChain, finalUrl }
}

async function readCapped(response: Response): Promise<Uint8Array> {
  if (!response.body) return new Uint8Array()
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    if (!value) continue
    total += value.byteLength
    if (total > MAX_BODY) {
      await reader.cancel()
      break
    }
    chunks.push(value)
  }
  const out = new Uint8Array(Math.min(total, MAX_BODY))
  let offset = 0
  for (const chunk of chunks) {
    const slice = chunk.byteLength + offset > MAX_BODY ? chunk.subarray(0, MAX_BODY - offset) : chunk
    out.set(slice, offset)
    offset += slice.byteLength
  }
  return out
}

function inScope(url: string, target: URL, scope: SpiderOptions['scope'], prefix: string): boolean {
  try {
    const parsed = new URL(url)
    if (parsed.host !== target.host) return false
    if (scope === 'path-prefix') return parsed.pathname.startsWith(prefix) || parsed.pathname === prefix.slice(0, -1)
    return true
  } catch {
    return false
  }
}

function normalize(url: string): string {
  try {
    const parsed = new URL(url)
    parsed.hash = ''
    if ((parsed.protocol === 'http:' && parsed.port === '80') || (parsed.protocol === 'https:' && parsed.port === '443')) {
      parsed.port = ''
    }
    if (parsed.pathname.length > 1 && parsed.pathname.endsWith('/')) {
      // keep as-is; some servers differ on trailing slash
    }
    return parsed.href
  } catch {
    return url
  }
}

function header(headers: Headers, name: string): string {
  return headers.get(name) ?? ''
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

function headersFromRecord(record: Record<string, string | string[]>): Headers {
  const headers = new Headers()
  for (const [key, value] of Object.entries(record)) {
    if (Array.isArray(value)) value.forEach((v) => headers.append(key, v))
    else headers.set(key, value)
  }
  return headers
}

function guessMime(url: string): string {
  if (url.endsWith('.js')) return 'application/javascript'
  if (url.endsWith('.css')) return 'text/css'
  if (url.endsWith('.json') || url.endsWith('.webmanifest')) return 'application/json'
  if (url.endsWith('.pdf')) return 'application/pdf'
  if (url.endsWith('.xml')) return 'application/xml'
  if (url.endsWith('.txt')) return 'text/plain'
  return ''
}

function seedKind(source: string): 'robots' | 'sitemap' | 'manifest' | 'well-known' | 'html' | 'redirect' {
  if (source.includes('robots')) return 'robots'
  if (source.includes('sitemap')) return 'sitemap'
  if (source.includes('manifest')) return 'manifest'
  if (source.includes('well-known')) return 'well-known'
  if (source.includes('redirect')) return 'redirect'
  return 'html'
}

function skippedProbe(item: QueueItem, reason: string): ProbeResult {
  return {
    url: item.url,
    finalUrl: item.url,
    method: 'GET',
    status: 0,
    contentType: '',
    mime: '',
    headers: {},
    cookies: [],
    redirectChain: [],
    securityHeaders: { hsts: null, csp: null, xfo: null, xcto: null, xxss: null, referrerPolicy: null, permissionsPolicy: null },
    server: '',
    size: 0,
    depth: item.depth,
    source: item.source,
    skipped: reason,
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
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

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
