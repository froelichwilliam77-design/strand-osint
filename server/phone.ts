import { parsePhoneNumberFromString, type NumberType } from 'libphonenumber-js'
import type { IntelResult, SpiderEvent, SpiderOptions } from './types.ts'

const EMAIL_SEED_RE = /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i

export interface ParsedPhone {
  e164: string
  international: string
  national: string
  country: string | undefined
  callingCode: string
  type: NumberType | undefined
  valid: boolean
  possible: boolean
}

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

export function parsePhoneSeed(raw: string): ParsedPhone | null {
  const s = raw.trim()
  if (!s) return null
  if (/^mailto:/i.test(s) || s.includes('@') || /^https?:/i.test(s)) return null
  if (/[A-Za-z]/.test(s.replace(/\b(ext|x)\b\.?/gi, ''))) return null
  const digits = s.replace(/\D/g, '')
  if (digits.length < 8 || digits.length > 15) return null

  const parsed =
    parsePhoneNumberFromString(s) ||
    (s.startsWith('+') ? undefined : parsePhoneNumberFromString(s, 'US'))
  if (!parsed || !parsed.isPossible()) return null
  return {
    e164: parsed.number,
    international: parsed.formatInternational(),
    national: parsed.formatNational(),
    country: parsed.country,
    callingCode: parsed.countryCallingCode,
    type: parsed.getType(),
    valid: parsed.isValid(),
    possible: parsed.isPossible(),
  }
}

export function phoneTypeLabel(type: NumberType | undefined): string {
  switch (type) {
    case 'MOBILE':
      return 'mobile'
    case 'FIXED_LINE':
      return 'fixed line'
    case 'FIXED_LINE_OR_MOBILE':
      return 'fixed line or mobile'
    case 'TOLL_FREE':
      return 'toll-free'
    case 'PREMIUM_RATE':
      return 'premium-rate'
    case 'VOIP':
      return 'VoIP'
    case 'PAGER':
      return 'pager'
    case 'UAN':
      return 'UAN'
    case 'VOICEMAIL':
      return 'voicemail'
    case 'SHARED_COST':
      return 'shared-cost'
    case 'PERSONAL_NUMBER':
      return 'personal number'
    default:
      return 'unknown numbering type'
  }
}

export async function runPhoneInvestigation(
  options: SpiderOptions,
  emit: (event: SpiderEvent) => void,
  signal: AbortSignal,
): Promise<void> {
  const parsed = parsePhoneSeed(options.target)
  if (!parsed) throw new Error('Not a phone seed')

  let intel = 0
  const stats = () => ({ probed: 0, forms: 0, scripts: 0, intel, queued: 0, skipped: 0 })
  const log = (level: 'info' | 'warn' | 'error' | 'skip', message: string) => {
    emit({ type: 'log', log: { ts: new Date().toISOString(), level, message } })
  }
  const push = (item: IntelResult) => {
    intel += 1
    emit({ type: 'intel', intel: item })
  }

  log(
    'info',
    `Public-records phone OSINT for ${parsed.e164} (parse + numbering-plan metadata only; no CNAM, SMS, or mailbox contact)`,
  )
  emit({ type: 'seed', seed: { url: `tel:${parsed.e164}`, kind: 'phone', detail: 'phone seed' } })
  emit({ type: 'status', status: 'running', stats: stats(), message: 'Phone investigation' })

  push({
    type: 'phone',
    value: parsed.e164,
    source: 'seed (E.164)',
    confidence: 'high',
    evidence: parsed.valid ? 'Valid numbering-plan number' : 'Possible but not a complete valid number',
  })
  push({
    type: 'phone',
    value: parsed.international,
    source: 'international format',
    confidence: 'high',
    evidence: 'libphonenumber public metadata',
  })
  push({
    type: 'phone',
    value: parsed.national,
    source: 'national format',
    confidence: 'medium',
    evidence: parsed.country ? `Region ${parsed.country}` : 'No region matched',
  })
  if (parsed.country) {
    push({
      type: 'domain',
      value: parsed.country,
      source: `ISO region for +${parsed.callingCode}`,
      confidence: 'high',
      evidence: 'Numbering-plan country / region (not a live carrier CNAM lookup)',
    })
  }
  push({
    type: 'account',
    value: phoneTypeLabel(parsed.type),
    site: 'Numbering plan',
    source: 'libphonenumber number type',
    confidence: parsed.type ? 'medium' : 'low',
    evidence:
      'Offline numbering-plan type (mobile / fixed / VoIP ranges). Not a live CNAM or SS7 query.',
    exists: parsed.valid,
  })

  if (signal.aborted) {
    emit({ type: 'status', status: 'stopped', stats: stats(), message: 'Stopped' })
    log('warn', 'Phone investigation stopped')
    return
  }

  log('info', `Done — phone OSINT ${intel} intel (no outbound calls or SMS)`)
  emit({ type: 'status', status: 'done', stats: stats(), message: `Complete — ${intel} intel (phone OSINT)` })
}
