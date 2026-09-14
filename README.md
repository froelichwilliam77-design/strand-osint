# STRAND

**OSINT SPIDER** — an active / semi-passive recon crawler in the Katana / Hakrawler vein. It actually fetches and parses pages: seed discovery, DOM link extraction, and MIME / header inspection.

Use it only against systems you are authorized to test.

## Run locally

```bash
npm install
npm run dev
```

Open [http://127.0.0.1:47631](http://127.0.0.1:47631). The Vite UI proxies `/api` to the spider on port `47632`.

Production-style single process:

```bash
npm run build
npm start
```

## Northline sample

You do not need a live target. Click **Load Northline sample** to aim the spider at `https://northline.sample/` — a built-in fake research portal (virtual host, not a public site).

A sample run with default settings should find on the order of dozens of URLs, plus forms (including CSRF hidden fields), JavaScript API paths, emails/phones, nested sitemaps, and a PDF. `/hidden-archive` exists only in the sitemap. `/admin` is disallowed by `robots.txt`; leave **Respect robots.txt** on to skip it, turn the toggle off to probe it.

The sample is also browsable at `/northline` on the API server for inspection, but the spider itself uses the virtual host so SSRF rules can keep blocking localhost.

## Safety

- Server-side probes allow only `http` / `https`.
- Private, loopback, link-local, CGNAT, and cloud metadata addresses are blocked, including after DNS resolution and on redirect hops.
- Semi-passive mode sends `HEAD` for binaries and never submits forms. Active mode GETs binary bodies; forms are still never submitted.
- Default scope is same host. Path-prefix scope stays under the target path.
- Default is to honor `robots.txt`. Rate limit with **Delay** and **Workers**.

## Tests

```bash
npm test
```

Covers SSRF URL/IP blocks, HTML/CSS/JS extractors, and a live crawl of the Northline sample (robots on vs off).
