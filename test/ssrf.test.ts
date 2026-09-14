import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { inspectUrlSafety, isBlockedIp } from '../server/ssrf.ts'

describe('SSRF protections', () => {
  const blocked = [
    'http://127.0.0.1/',
    'http://127.0.0.1:8080/secret',
    'https://localhost/admin',
    'http://[::1]/',
    'http://0.0.0.0/',
    'http://10.0.0.4/internal',
    'http://192.168.1.20/',
    'http://172.16.0.2/',
    'http://169.254.169.254/latest/meta-data/',
    'http://metadata.google.internal/',
    'http://metadata.goog/',
    'http://[fe80::1]/',
    'file:///etc/passwd',
    'gopher://example.com/',
    'ftp://example.com/',
    'dict://127.0.0.1:11211/stat',
    'http://2130706433/',
    'http://0x7f000001/',
    'http://127.1/',
    'http://localhost.localdomain/',
    'http://foo.localhost/',
    'http://[::ffff:127.0.0.1]/',
  ]

  for (const url of blocked) {
    it(`blocks ${url}`, () => {
      const result = inspectUrlSafety(url)
      assert.equal(result.ok, false, url)
    })
  }

  it('allows the Northline virtual sample host', () => {
    const result = inspectUrlSafety('https://northline.sample/research')
    assert.equal(result.ok, true)
  })

  it('allows a public https URL at the inspection layer', () => {
    const result = inspectUrlSafety('https://example.com/')
    assert.equal(result.ok, true)
  })

  it('flags loopback and RFC1918 addresses', () => {
    assert.equal(isBlockedIp('127.0.0.1'), true)
    assert.equal(isBlockedIp('10.1.2.3'), true)
    assert.equal(isBlockedIp('192.168.0.1'), true)
    assert.equal(isBlockedIp('169.254.169.254'), true)
    assert.equal(isBlockedIp('8.8.8.8'), false)
    assert.equal(isBlockedIp('1.1.1.1'), false)
  })
})
