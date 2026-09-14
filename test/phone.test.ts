import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { parsePhoneSeed, phoneTypeLabel, runPhoneInvestigation } from '../server/phone.ts'
import { DEFAULT_OPTIONS, type IntelResult, type SpiderEvent } from '../server/types.ts'

describe('phone parsing', () => {
  it('normalizes E.164-ish US numbers', () => {
    const parsed = parsePhoneSeed('+1 206 555 0100')
    assert.ok(parsed)
    assert.equal(parsed?.e164.startsWith('+1'), true)
    assert.equal(parsed?.country, 'US')
    assert.ok(parsed?.possible)
  })

  it('rejects emails and URLs', () => {
    assert.equal(parsePhoneSeed('ops@northline.sample'), null)
    assert.equal(parsePhoneSeed('https://example.com'), null)
    assert.equal(parsePhoneSeed('octocat'), null)
    assert.equal(parsePhoneSeed('123'), null)
  })

  it('labels numbering-plan types', () => {
    assert.equal(phoneTypeLabel('MOBILE'), 'mobile')
    assert.equal(phoneTypeLabel(undefined), 'unknown numbering type')
  })
})

describe('phone investigation', () => {
  it('emits E.164 and region intel without outbound HTTP', async () => {
    const intel: IntelResult[] = []
    const logs: string[] = []
    await runPhoneInvestigation(
      { ...DEFAULT_OPTIONS, target: '+12065550100' },
      (event: SpiderEvent) => {
        if (event.type === 'intel') intel.push(event.intel)
        if (event.type === 'log') logs.push(event.log.message)
      },
      new AbortController().signal,
    )
    assert.ok(intel.some((i) => i.type === 'phone' && i.value.startsWith('+1') && i.confidence === 'high'))
    assert.ok(intel.some((i) => i.value === 'US'))
    assert.ok(logs.some((m) => /no CNAM/i.test(m)))
    assert.ok(logs.some((m) => /no outbound calls or SMS/i.test(m)))
  })
})
