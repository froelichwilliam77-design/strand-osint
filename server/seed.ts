import { parseEmailSeed, parsePhoneSeed } from './phone.ts'

export type SeedKind = 'url' | 'email' | 'username' | 'phone' | 'unknown'

export interface ClassifiedSeed {
  kind: SeedKind
  value: string
  display: string
}

const USERNAME_RE = /^@?[A-Za-z0-9](?:[A-Za-z0-9._-]{0,37}[A-Za-z0-9])?$/
const HOST_LIKE_RE = /^(?:[A-Za-z0-9-]+\.)+[A-Za-z]{2,}(?:[/:?#].*)?$/

export function classifySeed(raw: string): ClassifiedSeed {
  const trimmed = String(raw ?? '').trim()
  if (!trimmed) return { kind: 'unknown', value: '', display: '' }

  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const url = new URL(trimmed)
      return { kind: 'url', value: url.href, display: url.href }
    } catch {
      return { kind: 'unknown', value: trimmed, display: trimmed }
    }
  }

  const email = parseEmailSeed(trimmed)
  if (email) return { kind: 'email', value: email, display: email }

  const phone = parsePhoneSeed(trimmed)
  if (phone) return { kind: 'phone', value: phone.e164, display: phone.e164 }

  if (trimmed.startsWith('@') || USERNAME_RE.test(trimmed)) {
    const handle = trimmed.replace(/^@/, '')
    if (handle && !handle.includes('@') && !HOST_LIKE_RE.test(handle) && !/^[\d._-]+$/.test(handle)) {
      return { kind: 'username', value: handle, display: handle }
    }
  }

  if (HOST_LIKE_RE.test(trimmed) && !/\s/.test(trimmed)) {
    try {
      const url = new URL(`https://${trimmed}`)
      return { kind: 'url', value: url.href, display: url.href }
    } catch {
      /* fall through */
    }
  }

  if (USERNAME_RE.test(trimmed.replace(/^@/, '')) && !/^[\d._-]+$/.test(trimmed.replace(/^@/, ''))) {
    return { kind: 'username', value: trimmed.replace(/^@/, ''), display: trimmed.replace(/^@/, '') }
  }

  return { kind: 'unknown', value: trimmed, display: trimmed }
}

export function isUrlSeed(raw: string): boolean {
  return classifySeed(raw).kind === 'url'
}

export function isEmailTarget(raw: string): boolean {
  return classifySeed(raw).kind === 'email'
}

export function isUsernameSeed(raw: string): boolean {
  return classifySeed(raw).kind === 'username'
}

export function isPhoneTarget(raw: string): boolean {
  return classifySeed(raw).kind === 'phone'
}
