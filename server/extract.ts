import * as cheerio from 'cheerio'
import { XMLParser } from 'fast-xml-parser'
import type { FormResult } from './types.ts'

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi
const PHONE_RE = /(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s])\d{3}[-.\s]\d{4}/g
const CSS_URL_RE = /url\(\s*['"]?([^'")\s]+)['"]?\s*\)/gi
const FETCH_RE =
  /(?:fetch|axios\.(?:get|post|put|patch|delete)|open)\s*\(\s*['"`]([^'"`]+)['"`]/gi
const ABS_URL_RE = /['"`](https?:\/\/[^'"`\s]+)['"`]/gi
const API_PATH_RE =
  /['"`](\/(?:api|v\d+|assets|static|docs|research|admin|internal|hidden|archive|login|app|team|legal)[^'"`\s]*)['"`]/gi
const FILE_PATH_RE = /['"`](\/[A-Za-z0-9_\-./]+\.(?:js|json|xml|pdf|html|css|txt|woff2?|webmanifest))['"`]/gi

const SKIP_SCHEMES = /^(javascript|data|blob|about|file|mailto|tel|sms):/i

export interface ExtractedLink {
  url: string
  source: string
}

export interface Extraction {
  links: ExtractedLink[]
  forms: FormResult[]
  emails: { value: string; source: string }[]
  phones: { value: string; source: string }[]
  scripts: string[]
}

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  removeNSPrefix: true,
})

export function extractFromHtml(html: string, baseUrl: string, parseJs: boolean): Extraction {
  const out = emptyExtraction()
  const $ = cheerio.load(html)
  const add = (raw: string | undefined, source: string) => addLink(out, raw, baseUrl, source)

  $('a[href], area[href]').each((_, el) => add($(el).attr('href'), 'html[href]'))
  $('[src]').each((_, el) => add($(el).attr('src'), `html[${el.tagName} src]`))
  $('link[href], base[href]').each((_, el) => add($(el).attr('href'), 'html[link]'))
  $('form[action]').each((_, el) => add($(el).attr('action'), 'html[form action]'))
  $('iframe[src], embed[src], object[data], track[src], source[src]').each((_, el) => {
    add($(el).attr('src') || $(el).attr('data'), 'html[embed]')
  })
  $('[srcset]').each((_, el) => {
    for (const part of ($(el).attr('srcset') ?? '').split(',')) {
      add(part.trim().split(/\s+/)[0], 'html[srcset]')
    }
  })
  $('meta[http-equiv="refresh" i]').each((_, el) => {
    const content = $(el).attr('content') ?? ''
    const m = content.match(/url=(.+)/i)
    add(m?.[1]?.replace(/['"]/g, ''), 'html[meta refresh]')
  })
  $('meta[property="og:url"], meta[property="og:image"], meta[name="twitter:image"]').each((_, el) => {
    add($(el).attr('content'), 'html[meta]')
  })

  $('*').each((_, el) => {
    const attribs = (el as { attribs?: Record<string, string> }).attribs ?? {}
    for (const [key, value] of Object.entries(attribs)) {
      if (key.startsWith('data-') && value) addIfUrlish(out, value, baseUrl, `html[${key}]`)
      if (key === 'style' && value) extractCssUrls(out, value, baseUrl)
    }
  })

  $('style').each((_, el) => extractCssUrls(out, $(el).html() ?? '', baseUrl))
  $('script[src]').each((_, el) => {
    const src = $(el).attr('src')
    if (src) {
      add(src, 'html[script src]')
      const abs = resolveUrl(src, baseUrl)
      if (abs) out.scripts.push(abs)
    }
  })
  if (parseJs) {
    $('script:not([src])').each((_, el) => extractJs(out, $(el).html() ?? '', baseUrl))
  }
  $('script[type="application/ld+json"], script[type="application/json"]').each((_, el) => {
    extractJson(out, $(el).html() ?? '', baseUrl)
  })

  const commentRe = /<!--([\s\S]*?)-->/g
  let cm: RegExpExecArray | null
  while ((cm = commentRe.exec(html))) {
    extractLoose(out, cm[1] ?? '', baseUrl, 'html[comment]')
  }

  $('form').each((_, el) => {
    const form = $(el)
    const actionRaw = form.attr('action') ?? baseUrl
    const action = resolveUrl(actionRaw || baseUrl, baseUrl) ?? baseUrl
    const method = (form.attr('method') ?? 'GET').toUpperCase()
    const fields = form
      .find('input, textarea, select, button[name]')
      .toArray()
      .map((field) => {
        const $f = $(field)
        return {
          name: $f.attr('name') ?? '',
          type: $f.attr('type') || field.tagName,
          value: $f.attr('value') ?? '',
        }
      })
      .filter((f) => f.name)
    out.forms.push({ page: baseUrl, action, method, fields })
    add(actionRaw, 'html[form action]')
  })

  harvestIntel(out, $.root().text(), baseUrl)
  harvestIntel(out, html, baseUrl)
  return dedupe(out)
}

export function extractFromCss(css: string, baseUrl: string): Extraction {
  const out = emptyExtraction()
  extractCssUrls(out, css, baseUrl)
  harvestIntel(out, css, baseUrl)
  return dedupe(out)
}

export function extractFromJs(js: string, baseUrl: string): Extraction {
  const out = emptyExtraction()
  extractJs(out, js, baseUrl)
  harvestIntel(out, js, baseUrl)
  return dedupe(out)
}

export function extractFromJson(raw: string, baseUrl: string): Extraction {
  const out = emptyExtraction()
  extractJson(out, raw, baseUrl)
  harvestIntel(out, raw, baseUrl)
  return dedupe(out)
}

export function extractFromText(raw: string, baseUrl: string): Extraction {
  const out = emptyExtraction()
  extractLoose(out, raw, baseUrl, 'text')
  harvestIntel(out, raw, baseUrl)
  return dedupe(out)
}

export function parseSitemapXml(xml: string): { sitemaps: string[]; urls: string[] } {
  const sitemaps: string[] = []
  const urls: string[] = []
  let parsed: unknown
  try {
    parsed = xmlParser.parse(xml)
  } catch {
    return { sitemaps, urls }
  }
  const root = asRecord(parsed)
  const index = asRecord(root.sitemapindex)
  const urlset = asRecord(root.urlset)
  for (const item of asArray(index.sitemap)) {
    const loc = asRecord(item).loc
    if (typeof loc === 'string') sitemaps.push(loc)
  }
  for (const item of asArray(urlset.url)) {
    const loc = asRecord(item).loc
    if (typeof loc === 'string') urls.push(loc)
  }
  return { sitemaps, urls }
}

export function harvestIntel(out: Extraction, text: string, source: string) {
  for (const match of text.match(EMAIL_RE) ?? []) {
    out.emails.push({ value: match.toLowerCase(), source })
  }
  for (const match of text.match(PHONE_RE) ?? []) {
    out.phones.push({ value: match.replace(/\s+/g, ' ').trim(), source })
  }
}

function extractCssUrls(out: Extraction, css: string, baseUrl: string) {
  CSS_URL_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = CSS_URL_RE.exec(css))) addLink(out, m[1], baseUrl, 'css[url]')
}

function extractJs(out: Extraction, js: string, baseUrl: string) {
  walkRegex(FETCH_RE, js, (u) => addLink(out, u, baseUrl, 'js[fetch]'))
  walkRegex(ABS_URL_RE, js, (u) => addLink(out, u, baseUrl, 'js[url]'))
  walkRegex(API_PATH_RE, js, (u) => addLink(out, u, baseUrl, 'js[path]'))
  walkRegex(FILE_PATH_RE, js, (u) => addLink(out, u, baseUrl, 'js[file]'))
}

function extractJson(out: Extraction, raw: string, baseUrl: string) {
  try {
    walkJson(JSON.parse(raw), out, baseUrl, 0)
  } catch {
    extractLoose(out, raw, baseUrl, 'json')
  }
}

function walkJson(value: unknown, out: Extraction, baseUrl: string, depth: number) {
  if (depth > 8 || value == null) return
  if (typeof value === 'string') addIfUrlish(out, value, baseUrl, 'json')
  else if (Array.isArray(value)) value.forEach((v) => walkJson(v, out, baseUrl, depth + 1))
  else if (typeof value === 'object') {
    for (const v of Object.values(value as Record<string, unknown>)) walkJson(v, out, baseUrl, depth + 1)
  }
}

function extractLoose(out: Extraction, text: string, baseUrl: string, source: string) {
  walkRegex(/https?:\/\/[^\s"'<>]+/gi, text, (u) => addLink(out, u, baseUrl, source))
  walkRegex(/\/[A-Za-z0-9_\-./]+\.(?:html?|pdf|js|json|xml|css|txt)/gi, text, (u) => addLink(out, u, baseUrl, source))
}

function addIfUrlish(out: Extraction, value: string, baseUrl: string, source: string) {
  const v = value.trim()
  if (!v || v.length < 2 || v.length > 2000) return
  if (/^https?:\/\//i.test(v) || v.startsWith('/') || v.startsWith('./') || v.startsWith('../')) {
    addLink(out, v, baseUrl, source)
  }
}

function addLink(out: Extraction, raw: string | undefined, baseUrl: string, source: string) {
  if (!raw) return
  const trimmed = raw.trim()
  if (!trimmed || trimmed.startsWith('#')) return
  if (SKIP_SCHEMES.test(trimmed)) {
    if (trimmed.toLowerCase().startsWith('mailto:')) {
      const email = trimmed.slice(7).split('?')[0]
      if (email) out.emails.push({ value: email.toLowerCase(), source })
    }
    if (trimmed.toLowerCase().startsWith('tel:')) {
      out.phones.push({ value: trimmed.slice(4), source })
    }
    return
  }
  const abs = resolveUrl(trimmed, baseUrl)
  if (abs) out.links.push({ url: abs, source })
}

export function resolveUrl(raw: string, baseUrl: string): string | null {
  try {
    const url = new URL(raw, baseUrl)
    url.hash = ''
    if (!/^https?:$/i.test(url.protocol)) return null
    return url.href
  } catch {
    return null
  }
}

function walkRegex(re: RegExp, text: string, fn: (m: string) => void) {
  re.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) fn(m[1] ?? m[0] ?? '')
}

function emptyExtraction(): Extraction {
  return { links: [], forms: [], emails: [], phones: [], scripts: [] }
}

function dedupe(out: Extraction): Extraction {
  const links: ExtractedLink[] = []
  const seen = new Set<string>()
  for (const link of out.links) {
    const key = `${link.source}|${link.url}`
    if (seen.has(key)) continue
    seen.add(key)
    links.push(link)
  }
  return {
    links,
    forms: out.forms,
    emails: uniqueIntel(out.emails),
    phones: uniqueIntel(out.phones),
    scripts: [...new Set(out.scripts)],
  }
}

function uniqueIntel(items: { value: string; source: string }[]) {
  const seen = new Set<string>()
  const out: { value: string; source: string }[] = []
  for (const item of items) {
    const key = item.value.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(item)
  }
  return out
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
}

function asArray(value: unknown): unknown[] {
  if (value == null) return []
  return Array.isArray(value) ? value : [value]
}
