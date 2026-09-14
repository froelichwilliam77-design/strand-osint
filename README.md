# STRAND

**OSINT SPIDER** — an active / semi-passive recon crawler in the Katana / Hakrawler vein. It actually fetches and parses pages: seed discovery, DOM link extraction, and MIME / header inspection.

Paste a **URL**, **email**, **@username**, or **phone** into Target. Use it only against systems and identifiers you are authorized to investigate.

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

## Seeds

| Target | What STRAND does |
| --- | --- |
| `https://…` or `example.com` | URL spider (seeds, DOM, headers). Hostnames without a scheme get `https://`. |
| `name@domain.com` | Email OSINT (below). Never treated as a crawl URL. |
| `@handle` or `octocat` | Public profile presence checks. |
| `+12065550100` | E.164 normalize + numbering-plan metadata only. |

Jobs never send SMTP, SMS, or phishing. Public-records / authorized-use warning stays on the desk.

### Email

Public records only:

- Local-part / domain split, consumer-mailbox hints, small disposable-domain list
- DNS MX
- Gravatar existence (public MD5 avatar + profile JSON)
- **Holehe-style site checks** for a practical set (GitHub public email search, Keybase, Duolingo, Spotify, WordPress.com, Imgur, Pinterest, Tumblr, Chess.com). Register / login / public APIs only — **never password-reset** (that would contact the mailbox)
- Public **profile probes** for the local-part handle (GitHub, GitLab, Reddit, HN, npm, …). Hits are HTTP-confirmed pages
- Derived username variants are **unverified** and secondary in the Intel tab — not dumped as fake social findings

### Username

SSRF-guarded GET of public profile URLs. Confirmed pages stream into Intel / Endpoints with confidence. Inconclusive login walls are logged, not treated as hits.

### Phone

[libphonenumber](https://gitlab.com/catamphetamine/libphonenumber-js) metadata: E.164, national/international format, ISO region, numbering-plan type (mobile / fixed / VoIP ranges). **No CNAM, SS7, SMS, or live carrier dips.**

## Safety

- Server-side probes allow only `http` / `https`.
- Private, loopback, link-local, CGNAT, and cloud metadata addresses are blocked, including after DNS resolution and on redirect hops.
- Semi-passive mode sends `HEAD` for binaries and never submits forms. Active mode GETs binary bodies; forms are still never submitted.
- Default scope is same host. Path-prefix scope stays under the target path.
- Default is to honor `robots.txt`. Rate limit with **Delay** and **Workers**.
- Presence checks share those SSRF guards and a small worker pool.

## Tests

```bash
npm test
```

Covers SSRF URL/IP blocks, HTML/CSS/JS extractors, seed classification, holehe-style interpreters, email/username/phone OSINT, and a live crawl of the Northline sample (robots on vs off).
