import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { extractFromCss, extractFromHtml, extractFromJs, extractFromJson } from '../server/extract.ts'

const base = 'https://northline.sample/research'

describe('DOM / link extraction', () => {
  it('pulls href, src, action, srcset, data-*, comments, and forms', () => {
    const html = `
      <a href="/docs/whitepaper.pdf">pdf</a>
      <img src="/assets/lab.jpg" srcset="/assets/lab.jpg 1x, /assets/lab-2x.jpg 2x" />
      <form action="/login" method="post">
        <input type="hidden" name="csrf_token" value="abc" />
        <input name="username" />
      </form>
      <div data-endpoint="/api/v1/catalog" data-url="https://northline.sample/api/v1/projects"></div>
      <!-- staging mirror: https://northline.sample/archive/legacy-index.html -->
      <script>fetch('/api/v2/telemetry')</script>
    `
    const out = extractFromHtml(html, base, true)
    const urls = out.links.map((l) => l.url)
    assert.ok(urls.some((u) => u.endsWith('/docs/whitepaper.pdf')))
    assert.ok(urls.some((u) => u.endsWith('/assets/lab-2x.jpg')))
    assert.ok(urls.some((u) => u.endsWith('/api/v1/catalog')))
    assert.ok(urls.some((u) => u.includes('/archive/legacy-index.html')))
    assert.ok(urls.some((u) => u.endsWith('/api/v2/telemetry')))
    assert.equal(out.forms.length, 1)
    assert.ok(out.forms[0]?.fields.some((f) => f.name === 'csrf_token'))
  })

  it('extracts CSS url() references', () => {
    const out = extractFromCss(`body { background: url('/assets/coast.jpg'); }`, base)
    assert.ok(out.links.some((l) => l.url.endsWith('/assets/coast.jpg')))
  })

  it('extracts JS fetch and JSON hrefs', () => {
    const js = extractFromJs(`fetch('/api/v1/catalog'); const x = "https://northline.sample/api/v1/staff";`, base)
    assert.ok(js.links.some((l) => l.url.endsWith('/api/v1/catalog')))
    assert.ok(js.links.some((l) => l.url.endsWith('/api/v1/staff')))
    const json = extractFromJson(JSON.stringify({ href: '/research/quantum-mesh' }), base)
    assert.ok(json.links.some((l) => l.url.endsWith('/research/quantum-mesh')))
  })
})
