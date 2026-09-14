import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { parseOptions } from '../server/options.ts'
import { classifySeed } from '../server/seed.ts'

describe('seed classification', () => {
  it('classifies URL, email, username, and phone', () => {
    assert.equal(classifySeed('https://example.com/path').kind, 'url')
    assert.equal(classifySeed('example.com').kind, 'url')
    assert.equal(classifySeed('example.com').value, 'https://example.com/')
    assert.equal(classifySeed('Mitchellkrystin24@gmail.com').kind, 'email')
    assert.equal(classifySeed('mailto:ops@northline.sample').kind, 'email')
    assert.equal(classifySeed('@octocat').kind, 'username')
    assert.equal(classifySeed('@octocat').value, 'octocat')
    assert.equal(classifySeed('octocat').kind, 'username')
    assert.equal(classifySeed('+12065550194').kind, 'phone')
    assert.equal(classifySeed('not a url').kind, 'unknown')
  })

  it('does not treat digit strings as usernames', () => {
    const seed = classifySeed('555-123-4567')
    assert.notEqual(seed.kind, 'username')
  })

  it('parseOptions accepts username and phone and prepends https for hostnames', () => {
    assert.equal(parseOptions({ target: '@northline' }).target, 'northline')
    assert.equal(parseOptions({ target: 'octocat' }).target, 'octocat')
    const phone = parseOptions({ target: '+1 206 555 0194' })
    assert.match(phone.target, /^\+/)
    assert.equal(parseOptions({ target: 'northline.sample' }).target, 'https://northline.sample/')
  })
})
