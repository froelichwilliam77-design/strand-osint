# STRAND

**OSINT SPIDER** — an active / semi-passive recon crawler in the Katana / Hakrawler vein. It actually fetches and parses pages: seed discovery, DOM link extraction, and MIME / header inspection. Paste an email into the target field to run public-records email OSINT instead of a crawl.

Use it only against systems (and mailboxes) you are authorized to test.

## Run locally

```bash
npm install
npm run dev
```

Open [http://127.0.0.1:47631](http://127.0.0.1:47631). The Vite UI proxies `/api` to the spider on port `47632`.

Localtunnel (`*.loca.lt`) works in dev: Vite `server.allowedHosts` / `preview.allowedHosts` are set to `true` so tunneled Host headers are not blocked.

Production-style single process:

```bash
npm run build
npm start
```

## Northline sample

You do not need a live target. Click **Load Northline sample** to aim the spider at `https://northline.sample/` — a built-in fake research portal (virtual host, not a public site).

A sample run with default settings should find on the order of dozens of URLs, plus forms (including CSRF hidden fields), JavaScript API paths, emails/phones, nested sitemaps, and a PDF. `/hidden-archive` exists only in the sitemap. `/admin` is disallowed by `robots.txt`; leave **Respect robots.txt** on to skip it, turn the toggle off to probe it.

The sample is also browsable at `/northline` on the API server for inspection, but the spider itself uses the virtual host so SSRF rules can keep blocking localhost.

## Email seed

Paste an address such as `name@domain.com` into **Target URL or email**. STRAND will not treat that string as a crawl URL (`new URL(email)` is never used as a spider target). The email job is public-records only:

- Split local-part / domain and emit intel nodes
- DNS MX records and mailbox-provider ecosystem hints (Gmail, Outlook, Proton, …)
- Gravatar existence check via the public MD5 hash (avatar `d=404` plus profile JSON)
- Username derived from the local-part, with **unverified** profile URL candidates for common networks (GitHub, X, Reddit, LinkedIn, …)
- For non-mailbox custom domains, a single SSRF-guarded homepage probe (not a site-wide crawl)

Results land in the existing **Intel**, **Endpoints**, and **Log** tabs. The job never contacts the mailbox (no SMTP VRFY, no calendar invites, no phishing).

Holehe-style “is this email registered on site X?” checks are **not** bundled: they need a maintained module set and tend to be fragile. Gravatar + MX/ecosystem + username URL fan-out ship now; holehe is a follow-up if you want account-enumeration across web apps.

http(s) targets and the Northline sample still use the URL spider unchanged.

## Safety

- Server-side probes allow only `http` / `https`.
- Private, loopback, link-local, CGNAT, and cloud metadata addresses are blocked, including after DNS resolution and on redirect hops.
- Semi-passive mode sends `HEAD` for binaries and never submits forms. Active mode GETs binary bodies; forms are still never submitted.
- Default scope is same host. Path-prefix scope stays under the target path.
- Default is to honor `robots.txt`. Rate limit with **Delay** and **Workers**.
- Email mode stays on public hashes, public DNS, and public URL patterns.

## Tests

```bash
npm test
```

Covers SSRF URL/IP blocks, HTML/CSS/JS extractors, email seed detection / email OSINT, and a live crawl of the Northline sample (robots on vs off).
