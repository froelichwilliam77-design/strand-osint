import { BlockList, isIP } from 'node:net'
import { promises as dns } from 'node:dns'
import { NORTHLINE_HOSTS } from './northline.ts'

const blockedV4 = new BlockList()
blockedV4.addSubnet('0.0.0.0', 8, 'ipv4')
blockedV4.addSubnet('10.0.0.0', 8, 'ipv4')
blockedV4.addSubnet('100.64.0.0', 10, 'ipv4')
blockedV4.addSubnet('127.0.0.0', 8, 'ipv4')
blockedV4.addSubnet('169.254.0.0', 16, 'ipv4')
blockedV4.addSubnet('172.16.0.0', 12, 'ipv4')
blockedV4.addSubnet('192.0.0.0', 24, 'ipv4')
blockedV4.addSubnet('192.168.0.0', 16, 'ipv4')
blockedV4.addSubnet('198.18.0.0', 15, 'ipv4')
blockedV4.addSubnet('224.0.0.0', 4, 'ipv4')
blockedV4.addSubnet('240.0.0.0', 4, 'ipv4')

const blockedV6 = new BlockList()
blockedV6.addAddress('::', 'ipv6')
blockedV6.addAddress('::1', 'ipv6')
blockedV6.addSubnet('fc00::', 7, 'ipv6')
blockedV6.addSubnet('fe80::', 10, 'ipv6')
blockedV6.addSubnet('ff00::', 8, 'ipv6')
blockedV6.addSubnet('2001:db8::', 32, 'ipv6')
blockedV6.addSubnet('::ffff:0:0', 96, 'ipv6')

const BLOCKED_HOSTS = new Set([
  'localhost',
  'localhost.localdomain',
  'ip6-localhost',
  'ip6-loopback',
  'metadata.google.internal',
  'metadata.goog',
  'metadata',
  'instance-data',
])

const ALLOWED_SCHEMES = new Set(['http:', 'https:'])

export class SsrfError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SsrfError'
  }
}

export function isNorthlineHost(hostname: string): boolean {
  return NORTHLINE_HOSTS.has(hostname.toLowerCase().replace(/\.$/, ''))
}

export function isBlockedIp(ip: string): boolean {
  const family = isIP(ip)
  if (family === 4) return blockedV4.check(ip, 'ipv4')
  if (family === 6) {
    const mapped = extractMappedIpv4(ip)
    if (mapped) return isBlockedIp(mapped)
    return blockedV6.check(normalizeIpv6(ip), 'ipv6')
  }
  return true
}

export function inspectUrlSafety(raw: string): { ok: true } | { ok: false; reason: string } {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return { ok: false, reason: 'Invalid URL' }
  }
  if (!ALLOWED_SCHEMES.has(url.protocol)) {
    return { ok: false, reason: `Blocked scheme ${url.protocol.replace(':', '')}` }
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase()
  if (!hostname) return { ok: false, reason: 'Missing hostname' }
  if (isNorthlineHost(hostname)) return { ok: true }
  if (BLOCKED_HOSTS.has(hostname) || hostname.endsWith('.localhost')) {
    return { ok: false, reason: `Blocked hostname ${hostname}` }
  }
  if (hostname.endsWith('.internal') || hostname.endsWith('.local')) {
    return { ok: false, reason: `Blocked hostname ${hostname}` }
  }
  const literal = coerceLiteralIp(hostname)
  if (literal && isBlockedIp(literal)) {
    return { ok: false, reason: `Blocked address ${literal}` }
  }
  if (isIP(hostname) && isBlockedIp(hostname)) {
    return { ok: false, reason: `Blocked address ${hostname}` }
  }
  return { ok: true }
}

export async function assertSafeUrl(raw: string): Promise<URL> {
  const parsed = new URL(raw)
  const safety = inspectUrlSafety(raw)
  if (!safety.ok) throw new SsrfError(safety.reason)
  if (isNorthlineHost(parsed.hostname)) return parsed
  const ips = await resolveAll(parsed.hostname)
  if (ips.length === 0) throw new SsrfError(`Could not resolve ${parsed.hostname}`)
  for (const ip of ips) {
    if (isBlockedIp(ip)) throw new SsrfError(`Blocked resolved address ${ip} for ${parsed.hostname}`)
  }
  return parsed
}

export async function resolveAll(hostname: string): Promise<string[]> {
  const found = new Set<string>()
  const lookups = await Promise.allSettled([
    dns.lookup(hostname, { all: true, verbatim: true }),
    dns.resolve4(hostname),
    dns.resolve6(hostname),
  ])
  const first = lookups[0]
  if (first.status === 'fulfilled') {
    for (const rec of first.value) found.add(rec.address)
  }
  const v4 = lookups[1]
  if (v4.status === 'fulfilled') {
    for (const ip of v4.value) found.add(ip)
  }
  const v6 = lookups[2]
  if (v6.status === 'fulfilled') {
    for (const ip of v6.value) found.add(ip)
  }
  return [...found]
}

function coerceLiteralIp(hostname: string): string | null {
  if (isIP(hostname)) return hostname
  if (/^0x[0-9a-f]+$/i.test(hostname)) {
    const n = Number.parseInt(hostname, 16)
    if (Number.isFinite(n)) return intToIpv4(n)
  }
  if (/^\d+$/.test(hostname)) {
    const n = Number(hostname)
    if (Number.isFinite(n) && n >= 0 && n <= 0xffffffff) return intToIpv4(n)
  }
  const dotted = hostname.split('.')
  if (dotted.length >= 2 && dotted.length <= 4 && dotted.every((p) => /^\d+$/.test(p))) {
    try {
      const parts = dotted.map((p) => Number(p))
      if (parts.some((n) => n < 0 || n > 255 && dotted.length === 4)) {
        // allow compact forms like 127.1 → 127.0.0.1
      }
      if (dotted.length === 4 && parts.every((n) => n >= 0 && n <= 255)) {
        return parts.join('.')
      }
      if (dotted.length === 2 && parts[0]! <= 255 && parts[1]! <= 0xffffff) {
        const n = (parts[0]! << 24) + parts[1]!
        return intToIpv4(n >>> 0)
      }
      if (dotted.length === 3 && parts[0]! <= 255 && parts[1]! <= 255 && parts[2]! <= 0xffff) {
        const n = (parts[0]! << 24) + (parts[1]! << 16) + parts[2]!
        return intToIpv4(n >>> 0)
      }
    } catch {
      return null
    }
  }
  return null
}

function intToIpv4(n: number): string {
  return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.')
}

function extractMappedIpv4(ip: string): string | null {
  const m = ip.toLowerCase().match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)
  if (m) return m[1] ?? null
  const m2 = ip.toLowerCase().match(/^::ffff:([0-9a-f:]+)$/)
  if (m2?.[1] && m2[1].includes(':')) return null
  return null
}

function normalizeIpv6(ip: string): string {
  return ip.replace(/^\[|\]$/g, '')
}
