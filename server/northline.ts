export const NORTHLINE_ORIGIN = 'https://northline.sample'
export const NORTHLINE_HOSTS = new Set(['northline.sample', 'northline.strand.lab'])


export interface NorthlineResponse {
  status: number
  headers: Record<string, string | string[]>
  body: Buffer
  redirectTo?: string
}

const PNG_DOT = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
)

const PDF = Buffer.from(
  `%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Count 1/Kids[3 0 R]>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R>>endobj
4 0 obj<</Length 68>>stream
BT /F1 18 Tf 72 720 Td (Northline Applied Research — Mesh Protocol Whitepaper) Tj ET
endstream
endobj
trailer<</Root 1 0 R>>
%%EOF
`,
)

function headers(contentType: string, extra: Record<string, string | string[]> = {}): Record<string, string | string[]> {
  return {
    'content-type': contentType,
    server: 'NorthlineCDN/2.4',
    'strict-transport-security': 'max-age=63072000; includeSubDomains',
    'content-security-policy': "default-src 'self'; img-src 'self' data:; script-src 'self' 'unsafe-inline'",
    'x-frame-options': 'SAMEORIGIN',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'strict-origin-when-cross-origin',
    'permissions-policy': 'camera=(), microphone=(), geolocation=()',
    'x-xss-protection': '0',
    'x-powered-by': 'Strand-Sample',
    ...extra,
  }
}

function html(status: number, title: string, body: string, extraHead = '', extraHeaders: Record<string, string | string[]> = {}): NorthlineResponse {
  const doc = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${title} — Northline Applied Research</title>
  <link rel="stylesheet" href="/assets/theme.css" />
  <link rel="manifest" href="/manifest.webmanifest" />
  <link rel="icon" href="/assets/icon.svg" />
  <link rel="sitemap" type="application/xml" href="/sitemap.xml" />
  ${extraHead}
</head>
<body>
  <header class="nav">
    <a class="brand" href="/">Northline</a>
    <nav>
      <a href="/about">About</a>
      <a href="/research">Research</a>
      <a href="/team">Team</a>
      <a href="/publications">Publications</a>
      <a href="/docs">Docs</a>
      <a href="/blog">Field notes</a>
      <a href="/partners">Partners</a>
      <a href="/careers">Careers</a>
      <a href="/press">Press</a>
      <a href="/contact">Contact</a>
      <a href="/login">Staff login</a>
    </nav>
  </header>
  <main>${body}</main>
  <footer>
    <p>Northline Applied Research · Seattle · <a href="mailto:hello@northline.sample">hello@northline.sample</a> · <a href="tel:+12065550142">+1-206-555-0142</a></p>
    <p>
      <a href="/legal/privacy">Privacy</a> ·
      <a href="/legal/terms">Terms</a> ·
      <a href="/legal/security-policy">Security policy</a> ·
      <a href="/admin">Admin</a>
    </p>
    <!-- staging mirror: https://northline.sample/archive/legacy-index.html -->
  </footer>
  <script src="/assets/app.js"></script>
  <script src="/assets/analytics.js"></script>
</body>
</html>`
  return { status, headers: headers('text/html; charset=utf-8', extraHeaders), body: Buffer.from(doc) }
}

function text(status: number, body: string, type: string, extra: Record<string, string | string[]> = {}): NorthlineResponse {
  return { status, headers: headers(type, extra), body: Buffer.from(body) }
}

function json(status: number, data: unknown): NorthlineResponse {
  return text(status, JSON.stringify(data, null, 2), 'application/json; charset=utf-8')
}

function redirect(to: string): NorthlineResponse {
  return {
    status: 302,
    headers: headers('text/plain; charset=utf-8', { location: to }),
    body: Buffer.from(`Redirecting to ${to}`),
    redirectTo: to,
  }
}

function notFound(path: string): NorthlineResponse {
  return html(404, 'Not found', `<h1>Not found</h1><p>No resource at ${escapeHtml(path)}.</p>`)
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c)
}

const APP_JS = `
const API = '/api/v1';
async function boot() {
  const catalog = await fetch('/api/v1/catalog');
  const projects = await fetch("https://northline.sample/api/v1/projects");
  const telemetry = fetch('/api/v2/telemetry');
  const staff = fetch('/api/v1/staff');
  window.__NORTHLINE_ENDPOINTS__ = ['/api/v1/catalog', '/api/v1/projects', '/api/v2/telemetry', '/api/v1/staff'];
  document.querySelector('[data-endpoint]')?.setAttribute('data-loaded', '1');
}
boot();
`

const ANALYTICS_JS = `
(function () {
  const endpoint = '/api/v1/metrics';
  navigator.sendBeacon && null;
  fetch(endpoint, { method: 'GET' });
})();
`

const THEME_CSS = `
@import url('/fonts/northline.woff2');
body { font-family: "Northline Sans", system-ui, sans-serif; margin: 0; background: #0f1410; color: #e7efe3; }
.nav { display: flex; gap: 1.5rem; padding: 1rem 1.5rem; background: #161c18; }
.hero { min-height: 12rem; background-image: url('/assets/coast.jpg'); background-size: cover; }
.logo { background: url('/assets/icon.svg') no-repeat; }
a { color: #b7c9a4; }
`

const routes: Record<string, () => NorthlineResponse> = {
  '/': () =>
    html(
      200,
      'Home',
      `<section class="hero" data-src="/assets/coast.jpg" data-api="/api/v1/metrics">
         <h1>Northline Applied Research</h1>
         <p>Coastal sensing, mesh protocols, and field telemetry for authorized partners.</p>
         <form action="/newsletter" method="post">
           <label>Briefing list <input type="email" name="email" placeholder="you@lab.org" /></label>
           <input type="hidden" name="list_id" value="field-briefing" />
           <button type="submit">Subscribe</button>
         </form>
       </section>
       <ul>
         <li><a href="/research/quantum-mesh">Quantum mesh</a></li>
         <li><a href="/research/signal-lattice">Signal lattice</a></li>
         <li><a href="/research/coastal-sensors">Coastal sensors</a></li>
         <li><a href="/docs/whitepaper.pdf">Mesh protocol whitepaper (PDF)</a></li>
         <li><a href="/docs/api">Internal API notes</a></li>
       </ul>
       <script type="application/ld+json">
       {"@context":"https://schema.org","@type":"ResearchOrganization","name":"Northline Applied Research","url":"https://northline.sample/","email":"press@northline.sample","telephone":"+1-206-555-0194"}
       </script>`,
      `<meta property="og:url" content="https://northline.sample/" />
       <meta property="og:image" content="/assets/coast.jpg" />`,
    ),
  '/about': () =>
    html(
      200,
      'About',
      `<h1>About Northline</h1>
       <p>Independent lab. Media: <a href="mailto:press@northline.sample">press@northline.sample</a>.</p>
       <p>Switchboard <a href="tel:+12065550194">+1-206-555-0194</a>.</p>
       <p>See also <a href="/partners">partners</a> and <a href="/legal/security-policy">disclosure policy</a>.</p>`,
    ),
  '/team': () =>
    html(
      200,
      'Team',
      `<h1>Principal investigators</h1>
       <ul>
         <li>Lina Okada — <a href="mailto:lina.okada@northline.sample">lina.okada@northline.sample</a> — <a href="tel:+12065550111">+1-206-555-0111</a></li>
         <li>Marco Vell — <a href="mailto:marco.vell@northline.sample">marco.vell@northline.sample</a> — <a href="tel:+12065550112">+1-206-555-0112</a></li>
       </ul>
       <p>Careers: <a href="mailto:careers@northline.sample">careers@northline.sample</a></p>
       <img src="/assets/lab.jpg" alt="Lab" srcset="/assets/lab.jpg 1x, /assets/lab-2x.jpg 2x" />`,
    ),
  '/research': () =>
    html(
      200,
      'Research',
      `<h1>Active programs</h1>
       <a href="/research/quantum-mesh">Quantum mesh</a>
       <a href="/research/signal-lattice">Signal lattice</a>
       <a href="/research/coastal-sensors">Coastal sensors</a>
       <p>Index also at <a href="/research/index">/research/index</a>.</p>`,
    ),
  '/research/index': () => redirect('/research'),
  '/research/quantum-mesh': () =>
    html(
      200,
      'Quantum mesh',
      `<h1>Quantum mesh</h1>
       <p>Live catalog is JS-only.</p>
       <div data-endpoint="/api/v1/catalog" data-url="/api/v1/projects"></div>
       <script>
         fetch('/api/v1/catalog');
         fetch('/internal/notes.json');
       </script>`,
    ),
  '/research/signal-lattice': () =>
    html(200, 'Signal lattice', `<h1>Signal lattice</h1><p>See <a href="/publications/2023/field-manual">field manual</a>.</p>`),
  '/research/coastal-sensors': () =>
    html(200, 'Coastal sensors', `<h1>Coastal sensors</h1><p>Hardware notes live under <a href="/docs">docs</a>.</p>`),
  '/publications': () =>
    html(
      200,
      'Publications',
      `<h1>Publications</h1>
       <a href="/publications/2024/mesh-protocol">2024 mesh protocol</a>
       <a href="/publications/2023/field-manual">2023 field manual</a>
       <a href="/docs/whitepaper.pdf">PDF whitepaper</a>`,
    ),
  '/publications/2024/mesh-protocol': () =>
    html(200, 'Mesh protocol', `<h1>Mesh protocol (2024)</h1><p>Download <a href="/docs/whitepaper.pdf">the PDF</a>.</p>`),
  '/publications/2023/field-manual': () =>
    html(200, 'Field manual', `<h1>Field manual</h1><p>Related: <a href="/blog/field-notes">field notes</a>.</p>`),
  '/contact': () =>
    html(
      200,
      'Contact',
      `<h1>Contact the lab</h1>
       <p>Security: <a href="mailto:security@northline.sample">security@northline.sample</a></p>
       <form action="/contact" method="post">
         <input name="name" type="text" />
         <input name="email" type="email" />
         <textarea name="message"></textarea>
         <input type="hidden" name="csrf_token" value="nl_csrf_9f3a2c" />
         <input type="hidden" name="topic" value="general" />
         <button type="submit">Send</button>
       </form>`,
    ),
  '/login': () =>
    html(
      200,
      'Staff login',
      `<h1>Staff login</h1>
       <form action="/login" method="post" id="login-form">
         <input name="username" type="text" autocomplete="username" />
         <input name="password" type="password" autocomplete="current-password" />
         <input type="hidden" name="csrf_token" value="nl_csrf_login_aa91" />
         <input type="hidden" name="next" value="/admin" />
         <button type="submit">Sign in</button>
       </form>`,
      '',
      { 'set-cookie': 'nl_session=pending; Path=/; HttpOnly; SameSite=Lax' },
    ),
  '/docs': () =>
    html(
      200,
      'Docs',
      `<h1>Documentation</h1>
       <a href="/docs/api">API</a>
       <a href="/docs/whitepaper.pdf">Whitepaper</a>
       <a href="/docs/integration-notes.html">Integration notes</a>`,
    ),
  '/docs/api': () =>
    html(
      200,
      'API notes',
      `<h1>API notes</h1>
       <p>Browser clients load <code>/api/v1/catalog</code> from <a href="/assets/app.js">app.js</a>.</p>
       <pre>GET /api/v1/projects
GET /api/v2/telemetry</pre>`,
    ),
  '/docs/integration-notes.html': () =>
    html(200, 'Integration notes', `<h1>Integration notes</h1><p>Partner ingest: <a href="/partners">/partners</a>.</p>`),
  '/press': () =>
    html(200, 'Press', `<h1>Press</h1><p><a href="mailto:press@northline.sample">press@northline.sample</a></p>`),
  '/careers': () =>
    html(
      200,
      'Careers',
      `<h1>Careers</h1>
       <form action="/careers/apply" method="post">
         <input name="name" type="text" />
         <input name="email" type="email" />
         <input name="role" type="text" value="field-engineer" />
         <input type="hidden" name="csrf_token" value="nl_csrf_hire_17" />
         <button type="submit">Apply</button>
       </form>`,
    ),
  '/legal/privacy': () => html(200, 'Privacy', `<h1>Privacy</h1><p>Contact <a href="mailto:privacy@northline.sample">privacy@northline.sample</a>.</p>`),
  '/legal/terms': () => html(200, 'Terms', `<h1>Terms</h1><p>Authorized research use only.</p>`),
  '/legal/security-policy': () =>
    html(200, 'Security policy', `<h1>Security policy</h1><p>Report to <a href="mailto:security@northline.sample">security@northline.sample</a>.</p>`),
  '/blog': () => html(200, 'Field notes', `<h1>Field notes</h1><a href="/blog/field-notes">Latest dispatch</a>`),
  '/blog/field-notes': () =>
    html(200, 'Dispatch', `<h1>Dispatch from the coast</h1><p>More at <a href="/research/coastal-sensors">coastal sensors</a>.</p>`),
  '/partners': () => html(200, 'Partners', `<h1>Partners</h1><p>Onboarding packet: <a href="/docs/integration-notes.html">integration notes</a>.</p>`),
  '/hidden-archive': () =>
    html(
      200,
      'Hidden archive',
      `<h1>Hidden archive</h1>
       <p>This page is listed only in the sitemap. Contact <a href="mailto:archive@northline.sample">archive@northline.sample</a>.</p>
       <a href="/archive/legacy-index.html">Legacy index</a>`,
    ),
  '/archive/legacy-index.html': () =>
    html(200, 'Legacy index', `<h1>Legacy index</h1><p>Retained for seed-discovery tests.</p>`),
  '/admin': () =>
    html(
      200,
      'Admin',
      `<h1>Admin console</h1>
       <p>Robots.txt disallows this path. <a href="/admin/users">Users</a></p>
       <form action="/admin/search" method="get">
         <input name="q" type="search" />
         <button type="submit">Search</button>
       </form>`,
    ),
  '/admin/users': () => html(200, 'Admin users', `<h1>Users</h1><p>Internal only.</p>`),
  '/robots.txt': () =>
    text(
      200,
      `User-agent: *
Disallow: /admin
Disallow: /admin/
Disallow: /internal
Allow: /
Sitemap: https://northline.sample/sitemap.xml
`,
      'text/plain; charset=utf-8',
    ),
  '/sitemap.xml': () =>
    text(
      200,
      `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <sitemap><loc>https://northline.sample/sitemap-pages.xml</loc></sitemap>
  <sitemap><loc>https://northline.sample/sitemap-docs.xml</loc></sitemap>
</sitemapindex>
`,
      'application/xml; charset=utf-8',
    ),
  '/sitemap-pages.xml': () =>
    text(
      200,
      `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://northline.sample/</loc></url>
  <url><loc>https://northline.sample/about</loc></url>
  <url><loc>https://northline.sample/team</loc></url>
  <url><loc>https://northline.sample/research</loc></url>
  <url><loc>https://northline.sample/publications</loc></url>
  <url><loc>https://northline.sample/contact</loc></url>
  <url><loc>https://northline.sample/hidden-archive</loc></url>
  <url><loc>https://northline.sample/press</loc></url>
  <url><loc>https://northline.sample/careers</loc></url>
</urlset>
`,
      'application/xml; charset=utf-8',
    ),
  '/sitemap-docs.xml': () =>
    text(
      200,
      `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://northline.sample/docs</loc></url>
  <url><loc>https://northline.sample/docs/whitepaper.pdf</loc></url>
  <url><loc>https://northline.sample/docs/api</loc></url>
  <url><loc>https://northline.sample/legal/security-policy</loc></url>
</urlset>
`,
      'application/xml; charset=utf-8',
    ),
  '/manifest.webmanifest': () =>
    json(200, {
      name: 'Northline Applied Research',
      short_name: 'Northline',
      start_url: '/',
      scope: '/',
      display: 'standalone',
      icons: [{ src: '/assets/icon-192.png', sizes: '192x192', type: 'image/png' }],
      shortcuts: [
        { name: 'Research', url: '/research' },
        { name: 'Docs', url: '/docs' },
      ],
    }),
  '/manifest.json': () => json(200, { name: 'Northline', start_url: '/', icons: [{ src: '/assets/icon.svg' }] }),
  '/humans.txt': () =>
    text(
      200,
      `/* TEAM */
Lead: Lina Okada
Contact: lina.okada@northline.sample
Site: https://northline.sample/team
`,
      'text/plain; charset=utf-8',
    ),
  '/.well-known/security.txt': () =>
    text(
      200,
      `Contact: mailto:security@northline.sample
Expires: 2027-12-31T23:59:59.000Z
Canonical: https://northline.sample/.well-known/security.txt
Policy: https://northline.sample/legal/security-policy
Hiring: https://northline.sample/careers
`,
      'text/plain; charset=utf-8',
    ),
  '/.well-known/change-password': () => redirect('/login'),
  '/.well-known/assetlinks.json': () => json(200, []),
  '/.well-known/apple-app-site-association': () => json(200, { applinks: { details: [] } }),
  '/assets/app.js': () => text(200, APP_JS, 'application/javascript; charset=utf-8'),
  '/assets/analytics.js': () => text(200, ANALYTICS_JS, 'application/javascript; charset=utf-8'),
  '/assets/theme.css': () => text(200, THEME_CSS, 'text/css; charset=utf-8'),
  '/assets/icon.svg': () =>
    text(200, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8" fill="#9cb48a"/></svg>`, 'image/svg+xml'),
  '/assets/icon-192.png': () => ({ status: 200, headers: headers('image/png'), body: PNG_DOT }),
  '/assets/coast.jpg': () => ({ status: 200, headers: headers('image/jpeg'), body: PNG_DOT }),
  '/assets/lab.jpg': () => ({ status: 200, headers: headers('image/jpeg'), body: PNG_DOT }),
  '/assets/lab-2x.jpg': () => ({ status: 200, headers: headers('image/jpeg'), body: PNG_DOT }),
  '/fonts/northline.woff2': () => ({ status: 200, headers: headers('font/woff2'), body: Buffer.from('wOF2') }),
  '/favicon.ico': () => ({ status: 200, headers: headers('image/x-icon'), body: PNG_DOT }),
  '/docs/whitepaper.pdf': () => ({ status: 200, headers: headers('application/pdf'), body: PDF }),
  '/api/v1/catalog': () =>
    json(200, {
      items: [
        { href: '/research/quantum-mesh' },
        { href: '/research/signal-lattice' },
        { related: 'https://northline.sample/api/v1/projects' },
      ],
    }),
  '/api/v1/projects': () => json(200, { projects: [{ url: '/research/coastal-sensors' }, { url: '/publications/2024/mesh-protocol' }] }),
  '/api/v1/staff': () => json(200, { directory: '/team', email: 'hello@northline.sample' }),
  '/api/v1/metrics': () => json(200, { ingest: '/api/v2/telemetry' }),
  '/api/v2/telemetry': () => json(200, { stream: '/api/v2/telemetry/tail', phone: '+1-206-555-0160' }),
  '/api/v2/telemetry/tail': () => json(200, { ok: true }),
  '/internal/notes.json': () => json(200, { note: 'robots-disallowed internal notes', see: '/admin' }),
  '/go/archive': () => redirect('/publications'),
  '/www': () => redirect('/'),
}

export function serveNorthline(url: URL): NorthlineResponse {
  const pathname = normalizePath(url.pathname)
  const handler = routes[pathname]
  if (handler) return handler()
  if (pathname.endsWith('/') && routes[pathname.slice(0, -1)]) return routes[pathname.slice(0, -1)]!()
  return notFound(pathname)
}

export function listNorthlinePaths(): string[] {
  return Object.keys(routes)
}

function normalizePath(pathname: string): string {
  if (!pathname || pathname === '/') return '/'
  try {
    return decodeURIComponent(pathname)
  } catch {
    return pathname
  }
}
