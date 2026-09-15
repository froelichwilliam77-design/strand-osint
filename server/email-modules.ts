import type { EmailModule, PresenceOutcome } from './presence.ts'

const JSON_HDR = {
  accept: 'application/json',
  'content-type': 'application/json',
}

const FORM_HDR = {
  accept: 'application/json, text/plain, */*',
  'content-type': 'application/x-www-form-urlencoded',
}

export function rateLimitStatus(status: number): PresenceOutcome | null {
  if (status === 429) return { exists: null, evidence: 'rate limited (429)', rateLimited: true }
  return null
}

export function interpretGithubSearch(status: number, body: string): PresenceOutcome {
  if (status === 403 || status === 429) return { exists: null, evidence: `rate limited (${status})`, rateLimited: true }
  if (status !== 200) return { exists: null, evidence: `HTTP ${status}` }
  try {
    const parsed = JSON.parse(body) as { total_count?: number; items?: Array<{ login?: string; html_url?: string }> }
    const count = parsed.total_count ?? 0
    const login = parsed.items?.[0]?.login
    if (count > 0) {
      return {
        exists: true,
        evidence: `GitHub user search in:email matched ${count} public profile(s)`,
        extra: login,
      }
    }
    return { exists: false, evidence: 'No public GitHub profile lists this email (private emails will not match)' }
  } catch {
    return { exists: null, evidence: 'GitHub search JSON unreadable' }
  }
}

export function interpretKeybase(status: number, body: string): PresenceOutcome {
  if (status !== 200) return { exists: null, evidence: `HTTP ${status}` }
  try {
    const parsed = JSON.parse(body) as { status?: { code?: number }; them?: unknown[] }
    if (parsed.status?.code === 205) return { exists: false, evidence: 'Keybase lookup code 205 (not found)' }
    if (parsed.status?.code === 0 && Array.isArray(parsed.them) && parsed.them.length > 0) {
      return { exists: true, evidence: 'Keybase public lookup matched' }
    }
    if (parsed.status?.code === 0) return { exists: false, evidence: 'Keybase lookup empty' }
    return { exists: null, evidence: `Keybase status ${parsed.status?.code ?? 'unknown'}` }
  } catch {
    return { exists: null, evidence: 'Keybase JSON unreadable' }
  }
}

export function interpretDuolingo(status: number, body: string): PresenceOutcome {
  if (status === 429) return { exists: null, evidence: 'rate limited', rateLimited: true }
  if (status !== 200) return { exists: null, evidence: `HTTP ${status}` }
  try {
    const parsed = JSON.parse(body) as { users?: Array<{ username?: string }> }
    if (Array.isArray(parsed.users) && parsed.users.length > 0) {
      return { exists: true, evidence: 'Duolingo users[] non-empty', extra: parsed.users[0]?.username }
    }
    return { exists: false, evidence: 'Duolingo users[] empty' }
  } catch {
    return { exists: null, evidence: 'Duolingo JSON unreadable' }
  }
}

export function interpretSpotify(status: number, body: string): PresenceOutcome {
  if (status === 429) return { exists: null, evidence: 'rate limited', rateLimited: true }
  try {
    const parsed = JSON.parse(body) as { status?: number }
    if (parsed.status === 20) return { exists: true, evidence: 'Spotify signup validate status 20 (taken)' }
    if (parsed.status === 1) return { exists: false, evidence: 'Spotify signup validate status 1 (available)' }
    return { exists: null, evidence: `Spotify status ${parsed.status ?? status}`, rateLimited: parsed.status === 99 }
  } catch {
    return { exists: null, evidence: `HTTP ${status}, Spotify JSON unreadable` }
  }
}

export function interpretWordpress(status: number, body: string): PresenceOutcome {
  if (status === 404) return { exists: false, evidence: 'HTTP 404 unknown user' }
  try {
    const parsed = JSON.parse(body) as {
      body?: { email_verified?: boolean; error?: string }
      code?: string | number
      error?: string
    }
    const inner = parsed.body ?? parsed
    const blob = JSON.stringify(parsed)
    if ('email_verified' in (inner as object)) {
      return inner.email_verified
        ? { exists: true, evidence: 'WordPress.com auth-options email_verified' }
        : { exists: false, evidence: 'WordPress.com email_verified false' }
    }
    if (/unknown_user|email_login_not_allowed/i.test(blob)) {
      return { exists: false, evidence: 'WordPress.com unknown_user' }
    }
    if (status >= 400) return { exists: null, evidence: `HTTP ${status}` }
    return { exists: null, evidence: 'WordPress.com response inconclusive' }
  } catch {
    return { exists: null, evidence: `HTTP ${status}` }
  }
}

export function interpretImgur(status: number, body: string): PresenceOutcome {
  if (status === 429) return { exists: null, evidence: 'rate limited', rateLimited: true }
  try {
    const parsed = JSON.parse(body) as { data?: { available?: boolean } | boolean; available?: boolean }
    const available = typeof parsed.data === 'object' ? parsed.data?.available : parsed.available
    if (available === true) return { exists: false, evidence: 'Imgur email available' }
    if (available === false) return { exists: true, evidence: 'Imgur email not available (registered)' }
    return { exists: null, evidence: `HTTP ${status} inconclusive` }
  } catch {
    return { exists: null, evidence: `HTTP ${status}` }
  }
}

export function interpretPinterest(status: number, body: string): PresenceOutcome {
  if (status === 429) return { exists: null, evidence: 'rate limited', rateLimited: true }
  try {
    const parsed = JSON.parse(body) as {
      resource_response?: { data?: boolean | { email_exists?: boolean } }
      data?: { email_exists?: boolean }
    }
    const data = parsed.resource_response?.data
    if (data === true) return { exists: true, evidence: 'Pinterest EmailExistsResource true' }
    if (data === false) return { exists: false, evidence: 'Pinterest EmailExistsResource false' }
    if (typeof data === 'object' && data && 'email_exists' in data) {
      return data.email_exists
        ? { exists: true, evidence: 'Pinterest email_exists true' }
        : { exists: false, evidence: 'Pinterest email_exists false' }
    }
    return { exists: null, evidence: `HTTP ${status} inconclusive` }
  } catch {
    return { exists: null, evidence: `HTTP ${status}` }
  }
}

export function interpretTumblr(status: number, body: string): PresenceOutcome {
  if (status === 429) return { exists: null, evidence: 'rate limited', rateLimited: true }
  try {
    const parsed = JSON.parse(body) as {
      response?: { error?: string }
      meta?: { status?: number }
      errors?: Array<{ code?: number; detail?: string }>
    }
    const blob = JSON.stringify(parsed)
    if (/email.*already.*used|already_registered|user_already_exists/i.test(blob)) {
      return { exists: true, evidence: 'Tumblr validate: email already used' }
    }
    if (status === 200 && /ok/i.test(blob) && !/error/i.test(blob)) {
      return { exists: false, evidence: 'Tumblr validate accepted email' }
    }
    if (status === 400 && /invalid/i.test(blob)) return { exists: false, evidence: 'Tumblr invalid email' }
    return { exists: null, evidence: `HTTP ${status} inconclusive` }
  } catch {
    return { exists: null, evidence: `HTTP ${status}` }
  }
}

export function interpretChess(status: number, body: string): PresenceOutcome {
  if (status !== 200) return { exists: null, evidence: `HTTP ${status}` }
  try {
    const parsed = JSON.parse(body) as { isEmailAvailable?: boolean; valid?: boolean }
    if (parsed.isEmailAvailable === false) return { exists: true, evidence: 'Chess.com isEmailAvailable false (taken)' }
    if (parsed.isEmailAvailable === true) return { exists: false, evidence: 'Chess.com isEmailAvailable true' }
    return { exists: null, evidence: 'Chess.com JSON missing isEmailAvailable' }
  } catch {
    return { exists: null, evidence: 'Chess.com JSON unreadable' }
  }
}

export function interpretFirefox(status: number, body: string): PresenceOutcome {
  const limited = rateLimitStatus(status)
  if (limited) return limited
  const text = body.trim().toLowerCase()
  try {
    const parsed = JSON.parse(body) as { exists?: boolean }
    if (parsed.exists === true) return { exists: true, evidence: 'Firefox Accounts exists:true' }
    if (parsed.exists === false) return { exists: false, evidence: 'Firefox Accounts exists:false' }
  } catch {
    /* holehe also matches raw true/false */
  }
  if (/\btrue\b/.test(text) && !/\bfalse\b/.test(text)) return { exists: true, evidence: 'Firefox Accounts body contains true' }
  if (/\bfalse\b/.test(text)) return { exists: false, evidence: 'Firefox Accounts body contains false' }
  return { exists: null, evidence: `HTTP ${status} inconclusive` }
}

export function interpretTwitterEmail(status: number, body: string): PresenceOutcome {
  const limited = rateLimitStatus(status)
  if (limited) return limited
  if (status === 401 || status === 403) return { exists: null, evidence: `Twitter API ${status} (auth wall)`, rateLimited: true }
  try {
    const parsed = JSON.parse(body) as { taken?: boolean; valid?: boolean }
    if (parsed.taken === true) return { exists: true, evidence: 'Twitter email_available taken:true' }
    if (parsed.taken === false) return { exists: false, evidence: 'Twitter email_available taken:false' }
    return { exists: null, evidence: 'Twitter JSON missing taken' }
  } catch {
    return { exists: null, evidence: `HTTP ${status}` }
  }
}

export function interpretLastpass(status: number, body: string): PresenceOutcome {
  const limited = rateLimitStatus(status)
  if (limited) return limited
  const text = body.trim().toLowerCase()
  if (text === 'no') return { exists: true, evidence: 'LastPass create_account check=no (taken)' }
  if (text === 'ok' || text === 'emailinvalid') return { exists: false, evidence: `LastPass create_account ${text}` }
  return { exists: null, evidence: `HTTP ${status} inconclusive` }
}

export function interpretMicrosoftLive(status: number, body: string): PresenceOutcome {
  const limited = rateLimitStatus(status)
  if (limited) return limited
  try {
    const parsed = JSON.parse(body) as { IfExistsResult?: number; IfExistsResultName?: string }
    const code = parsed.IfExistsResult
    // 0 = exists, 1 = does not, 5/6 = exists via other IdP / federation
    if (code === 0 || code === 5 || code === 6) {
      return { exists: true, evidence: `Microsoft GetCredentialType IfExistsResult ${code}` }
    }
    if (code === 1) return { exists: false, evidence: 'Microsoft GetCredentialType IfExistsResult 1 (not found)' }
    return { exists: null, evidence: `Microsoft IfExistsResult ${code ?? status}` }
  } catch {
    return { exists: null, evidence: `HTTP ${status}` }
  }
}

export function interpretMicrosoftRealm(status: number, body: string): PresenceOutcome {
  if (status !== 200) return { exists: null, evidence: `HTTP ${status}` }
  try {
    const parsed = JSON.parse(body) as {
      NameSpaceType?: string
      DomainName?: string
      FederationBrandName?: string
      Login?: string
    }
    const kind = (parsed.NameSpaceType ?? '').toLowerCase()
    const brand = (parsed.FederationBrandName ?? '').toLowerCase()
    const domain = (parsed.DomainName ?? '').toLowerCase()
    const loginDomain = (parsed.Login ?? '').split('@')[1]?.toLowerCase() ?? ''
    // Windows Live / live.com is Microsoft consumer routing, not proof of an M365 mailbox.
    if (brand.includes('windows live') || domain === 'live.com') {
      return { exists: false, evidence: 'GetUserRealm Windows Live routing (not an M365 tenant hit)' }
    }
    const consumer = new Set([
      'gmail.com',
      'googlemail.com',
      'outlook.com',
      'hotmail.com',
      'live.com',
      'msn.com',
      'yahoo.com',
      'icloud.com',
      'proton.me',
      'protonmail.com',
      'aol.com',
    ])
    if (consumer.has(loginDomain)) {
      return { exists: false, evidence: `GetUserRealm skipped for consumer mailbox ${loginDomain}` }
    }
    if ((kind === 'managed' || kind === 'federated') && domain && domain === loginDomain) {
      return {
        exists: true,
        confidence: 'medium',
        evidence: `GetUserRealm NameSpaceType ${parsed.NameSpaceType} for ${domain} (tenant exists; mailbox not proven)`,
      }
    }
    if (kind === 'unknown' || kind === '') {
      return { exists: false, evidence: 'GetUserRealm NameSpaceType Unknown (no M365 tenant)' }
    }
    return { exists: null, evidence: `GetUserRealm NameSpaceType ${parsed.NameSpaceType}` }
  } catch {
    return { exists: null, evidence: 'GetUserRealm JSON unreadable' }
  }
}

export function interpretProtonmail(status: number, body: string): PresenceOutcome {
  if (status !== 200) return { exists: null, evidence: `HTTP ${status}` }
  if (/info:1:0/.test(body)) return { exists: false, evidence: 'ProtonMail PKS info:1:0 (no published key)' }
  if (/info:1:1/.test(body)) return { exists: true, evidence: 'ProtonMail PKS info:1:1 (published OpenPGP key)' }
  return { exists: null, evidence: 'ProtonMail PKS inconclusive' }
}

export function interpretFreelancer(status: number, body: string): PresenceOutcome {
  const limited = rateLimitStatus(status)
  if (limited) return limited
  if (status === 409 && /EMAIL_ALREADY_IN_USE/i.test(body)) {
    return { exists: true, evidence: 'Freelancer EMAIL_ALREADY_IN_USE' }
  }
  if (status === 200) return { exists: false, evidence: 'Freelancer check 200 (email free)' }
  return { exists: null, evidence: `HTTP ${status}` }
}

export function interpretHubspot(status: number, body: string): PresenceOutcome {
  const limited = rateLimitStatus(status)
  if (limited) return limited
  try {
    const parsed = JSON.parse(body) as { status?: string }
    if (parsed.status === 'INVALID_PASSWORD') return { exists: true, evidence: 'HubSpot login INVALID_PASSWORD (user exists)' }
    if (parsed.status === 'INVALID_USER') return { exists: false, evidence: 'HubSpot login INVALID_USER' }
    return { exists: null, evidence: `HubSpot status ${parsed.status ?? status}` }
  } catch {
    return { exists: null, evidence: `HTTP ${status}` }
  }
}

function interpretUnused(): PresenceOutcome {
  return { exists: null, evidence: 'unused' }
}

function takenIf(body: string, pattern: RegExp, label: string, status: number): PresenceOutcome {
  if (pattern.test(body)) return { exists: true, evidence: label }
  if (status === 200) return { exists: false, evidence: `${label.split(':')[0]} 200 without taken marker` }
  return { exists: null, evidence: `HTTP ${status}` }
}

function jsonField(
  status: number,
  body: string,
  pick: (parsed: Record<string, unknown>) => boolean | null | undefined,
  labels: { yes: string; no: string },
): PresenceOutcome {
  const limited = rateLimitStatus(status)
  if (limited) return limited
  try {
    const parsed = JSON.parse(body) as Record<string, unknown>
    const value = pick(parsed)
    if (value === true) return { exists: true, evidence: labels.yes }
    if (value === false) return { exists: false, evidence: labels.no }
    return { exists: null, evidence: `HTTP ${status} inconclusive` }
  } catch {
    return { exists: null, evidence: `HTTP ${status}` }
  }
}

/** Holehe-inspired email registration checks. Never password-reset (no mailbox contact). */
export const EMAIL_MODULES: EmailModule[] = [
  {
    id: 'gravatar',
    name: 'Gravatar',
    domain: 'gravatar.com',
    method: 'other',
    request: () => ({ url: 'https://www.gravatar.com/', method: 'GET' }),
    interpret: interpretUnused,
  },
  {
    id: 'github',
    name: 'GitHub',
    domain: 'github.com',
    method: 'other',
    request: (email) => ({
      url: `https://api.github.com/search/users?q=${encodeURIComponent(`${email} in:email`)}`,
      method: 'GET',
      headers: { accept: 'application/vnd.github+json' },
    }),
    interpret: interpretGithubSearch,
  },
  {
    id: 'keybase',
    name: 'Keybase',
    domain: 'keybase.io',
    method: 'other',
    request: (email) => ({
      url: `https://keybase.io/_/api/1.0/user/lookup.json?email=${encodeURIComponent(email)}`,
      method: 'GET',
    }),
    interpret: interpretKeybase,
  },
  {
    id: 'duolingo',
    name: 'Duolingo',
    domain: 'duolingo.com',
    method: 'other',
    request: (email) => ({
      url: `https://www.duolingo.com/2017-06-30/users?email=${encodeURIComponent(email)}`,
      method: 'GET',
    }),
    interpret: interpretDuolingo,
  },
  {
    id: 'spotify',
    name: 'Spotify',
    domain: 'spotify.com',
    method: 'register',
    request: (email) => ({
      url: `https://spclient.wg.spotify.com/signup/public/v1/account?validate=1&email=${encodeURIComponent(email)}`,
      method: 'GET',
    }),
    interpret: interpretSpotify,
  },
  {
    id: 'wordpress',
    name: 'WordPress.com',
    domain: 'wordpress.com',
    method: 'login',
    request: (email) => ({
      url: `https://public-api.wordpress.com/rest/v1.1/users/${encodeURIComponent(email)}/auth-options?http_envelope=1`,
      method: 'GET',
    }),
    interpret: interpretWordpress,
  },
  {
    id: 'imgur',
    name: 'Imgur',
    domain: 'imgur.com',
    method: 'register',
    request: (email) => ({
      url: 'https://imgur.com/signin/ajax_email_available',
      method: 'POST',
      headers: FORM_HDR,
      body: `email=${encodeURIComponent(email)}`,
    }),
    interpret: interpretImgur,
  },
  {
    id: 'pinterest',
    name: 'Pinterest',
    domain: 'pinterest.com',
    method: 'register',
    request: (email) => ({
      url: `https://www.pinterest.com/_ngjs/resource/EmailExistsResource/get/?source_url=%2F&data=${encodeURIComponent(
        JSON.stringify({ options: { email }, context: {} }),
      )}`,
      method: 'GET',
    }),
    interpret: interpretPinterest,
  },
  {
    id: 'tumblr',
    name: 'Tumblr',
    domain: 'tumblr.com',
    method: 'register',
    request: (email) => ({
      url: 'https://www.tumblr.com/api/v2/register/account/validate',
      method: 'POST',
      headers: JSON_HDR,
      body: JSON.stringify({ email }),
    }),
    interpret: interpretTumblr,
  },
  {
    id: 'chess',
    name: 'Chess.com',
    domain: 'chess.com',
    method: 'register',
    request: (email) => ({
      url: `https://www.chess.com/callback/email/available?email=${encodeURIComponent(email)}`,
      method: 'GET',
    }),
    interpret: interpretChess,
  },
  {
    id: 'firefox',
    name: 'Firefox Accounts',
    domain: 'firefox.com',
    method: 'register',
    request: (email) => ({
      url: 'https://api.accounts.firefox.com/v1/account/status',
      method: 'POST',
      headers: FORM_HDR,
      body: `email=${encodeURIComponent(email)}`,
    }),
    interpret: interpretFirefox,
  },
  {
    id: 'twitter',
    name: 'X / Twitter',
    domain: 'twitter.com',
    method: 'register',
    request: (email) => ({
      url: `https://api.twitter.com/i/users/email_available.json?email=${encodeURIComponent(email)}`,
      method: 'GET',
    }),
    interpret: interpretTwitterEmail,
  },
  {
    id: 'lastpass',
    name: 'LastPass',
    domain: 'lastpass.com',
    method: 'register',
    request: (email) => ({
      url: `https://lastpass.com/create_account.php?check=avail&skipcontent=1&mistype=1&username=${encodeURIComponent(email)}`,
      method: 'GET',
      headers: { 'x-requested-with': 'XMLHttpRequest', referer: 'https://lastpass.com/' },
    }),
    interpret: interpretLastpass,
  },
  {
    id: 'flickr',
    name: 'Flickr',
    domain: 'flickr.com',
    method: 'login',
    request: (email) => ({
      url: `https://identity-api.flickr.com/migration?email=${encodeURIComponent(email)}`,
      method: 'GET',
      headers: { origin: 'https://identity.flickr.com', referer: 'https://identity.flickr.com/login' },
    }),
    interpret: (status, body) =>
      jsonField(status, body, (p) => (p.state_code === 5 || p.state_code === '5' ? true : p.state_code != null ? false : null), {
        yes: 'Flickr identity state_code 5',
        no: 'Flickr identity not state_code 5',
      }),
  },
  {
    id: 'anydo',
    name: 'Any.do',
    domain: 'any.do',
    method: 'login',
    request: (email) => ({
      url: 'https://sm-prod2.any.do/check_email',
      method: 'POST',
      headers: { ...JSON_HDR, 'x-platform': '3', origin: 'https://desktop.any.do' },
      body: JSON.stringify({ email }),
    }),
    interpret: (status, body) =>
      jsonField(status, body, (p) => (typeof p.user_exists === 'boolean' ? p.user_exists : null), {
        yes: 'Any.do user_exists true',
        no: 'Any.do user_exists false',
      }),
  },
  {
    id: 'replit',
    name: 'Replit',
    domain: 'replit.com',
    method: 'register',
    request: (email) => ({
      url: 'https://replit.com/data/user/exists',
      method: 'POST',
      headers: { ...JSON_HDR, origin: 'https://replit.com', 'x-requested-with': 'XMLHttpRequest' },
      body: JSON.stringify({ email }),
    }),
    interpret: (status, body) =>
      jsonField(status, body, (p) => (typeof p.exists === 'boolean' ? p.exists : null), {
        yes: 'Replit exists true',
        no: 'Replit exists false',
      }),
  },
  {
    id: 'issuu',
    name: 'Issuu',
    domain: 'issuu.com',
    method: 'register',
    request: (email) => ({
      url: `https://issuu.com/call/signup/check-email/${encodeURIComponent(email)}`,
      method: 'GET',
      headers: { accept: 'application/json', referer: 'https://issuu.com/signup' },
    }),
    interpret: (status, body) => {
      const limited = rateLimitStatus(status)
      if (limited) return limited
      try {
        const parsed = JSON.parse(body) as { status?: string }
        if (parsed.status === 'unavailable') return { exists: true, evidence: 'Issuu check-email unavailable (taken)' }
        if (parsed.status === 'available') return { exists: false, evidence: 'Issuu check-email available' }
        return { exists: null, evidence: `Issuu status ${parsed.status ?? status}` }
      } catch {
        return { exists: null, evidence: `HTTP ${status}` }
      }
    },
  },
  {
    id: 'docker',
    name: 'Docker Hub',
    domain: 'docker.com',
    method: 'register',
    request: (email) => ({
      url: 'https://hub.docker.com/v2/users/signup/',
      method: 'POST',
      headers: { ...JSON_HDR, origin: 'https://hub.docker.com', referer: 'https://hub.docker.com/signup' },
      body: JSON.stringify({
        email,
        password: '',
        recaptcha_response: '',
        redirect_value: '',
        subscribe: false,
        username: '',
      }),
    }),
    interpret: (status, body) => {
      if (/already in use|already exists/i.test(body)) return { exists: true, evidence: 'Docker Hub email already in use' }
      if (status === 400 || status === 200) return { exists: false, evidence: 'Docker Hub signup did not report taken' }
      return { exists: null, evidence: `HTTP ${status}` }
    },
  },
  {
    id: 'bodybuilding',
    name: 'Bodybuilding.com',
    domain: 'bodybuilding.com',
    method: 'register',
    request: (email) => ({
      url: `https://api.bodybuilding.com/profile/email/${encodeURIComponent(email)}`,
      method: 'HEAD',
      headers: { origin: 'https://www.bodybuilding.com', referer: 'https://www.bodybuilding.com/' },
    }),
    interpret: (status) => {
      if (status === 200) return { exists: true, evidence: 'Bodybuilding profile email HEAD 200' }
      if (status === 404) return { exists: false, evidence: 'Bodybuilding profile email HEAD 404' }
      return { exists: null, evidence: `HTTP ${status}` }
    },
  },
  {
    id: 'patreon',
    name: 'Patreon',
    domain: 'patreon.com',
    method: 'login',
    request: (email) => ({
      url: 'https://www.patreon.com/api/email/available?json-api-version=1.0&include=%5B%5D',
      method: 'POST',
      headers: {
        accept: '*/*',
        'content-type': 'application/vnd.api+json',
        origin: 'https://www.patreon.com',
      },
      body: JSON.stringify({ data: { attributes: { email }, relationships: {} } }),
    }),
    interpret: (status, body) => {
      const limited = rateLimitStatus(status)
      if (limited) return limited
      try {
        const parsed = JSON.parse(body) as { data?: { is_available?: boolean } }
        if (parsed.data?.is_available === true) return { exists: false, evidence: 'Patreon is_available true' }
        if (parsed.data?.is_available === false) return { exists: true, evidence: 'Patreon is_available false (registered)' }
        return { exists: null, evidence: `HTTP ${status} inconclusive` }
      } catch {
        return { exists: null, evidence: `HTTP ${status}` }
      }
    },
  },
  {
    id: 'plurk',
    name: 'Plurk',
    domain: 'plurk.com',
    method: 'register',
    request: (email) => ({
      url: 'https://www.plurk.com/Users/isEmailFound',
      method: 'POST',
      headers: { ...FORM_HDR, 'x-requested-with': 'XMLHttpRequest', origin: 'https://www.plurk.com' },
      body: `email=${encodeURIComponent(email)}`,
    }),
    interpret: (status, body) => {
      const text = body.trim()
      if (text === 'True') return { exists: true, evidence: 'Plurk isEmailFound True' }
      if (text === 'False') return { exists: false, evidence: 'Plurk isEmailFound False' }
      return { exists: null, evidence: `HTTP ${status}` }
    },
  },
  {
    id: 'discord',
    name: 'Discord',
    domain: 'discord.com',
    method: 'register',
    request: (email) => ({
      url: 'https://discord.com/api/v9/auth/register',
      method: 'POST',
      headers: { ...JSON_HDR, origin: 'https://discord.com' },
      body: JSON.stringify({
        fingerprint: '',
        email,
        username: `strand${Math.random().toString(36).slice(2, 10)}`,
        password: `Aa1!${Math.random().toString(36).slice(2, 12)}`,
        invite: null,
        consent: true,
        date_of_birth: '1990-01-01',
        gift_code_sku_id: null,
        captcha_key: null,
      }),
    }),
    interpret: (status, body) => {
      if (/EMAIL_ALREADY_REGISTERED|email.*already/i.test(body)) {
        return { exists: true, evidence: 'Discord EMAIL_ALREADY_REGISTERED' }
      }
      if (/captcha/i.test(body)) return { exists: null, evidence: 'Discord captcha (inconclusive)' }
      if (status === 400 || status === 201 || status === 200) {
        return { exists: false, evidence: 'Discord register did not report email taken' }
      }
      return { exists: null, evidence: `HTTP ${status}` }
    },
  },
  {
    id: 'deliveroo',
    name: 'Deliveroo',
    domain: 'deliveroo.com',
    method: 'register',
    request: (email) => ({
      url: 'https://consumer-ow-api.deliveroo.com/orderapp/v1/check-email',
      method: 'POST',
      headers: {
        ...JSON_HDR,
        'x-requested-with': 'XMLHttpRequest',
        'x-roo-client': 'orderweb-client',
        'x-roo-country': 'us',
        origin: 'https://deliveroo.com',
      },
      body: JSON.stringify({ email_address: email }),
    }),
    interpret: (status, body) =>
      jsonField(status, body, (p) => (typeof p.registered === 'boolean' ? p.registered : null), {
        yes: 'Deliveroo registered true',
        no: 'Deliveroo registered false',
      }),
  },
  {
    id: 'envato',
    name: 'Envato',
    domain: 'envato.com',
    method: 'register',
    request: (email) => ({
      url: 'https://account.envato.com/api/validate_email',
      method: 'POST',
      headers: FORM_HDR,
      body: `email=${encodeURIComponent(email)}`,
    }),
    interpret: (status, body) => {
      if (/already in use/i.test(body)) return { exists: true, evidence: 'Envato email already in use' }
      if (/kotulsky/i.test(body)) return { exists: null, evidence: 'Envato challenge page', rateLimited: true }
      if (status === 200) return { exists: false, evidence: 'Envato validate_email 200' }
      return { exists: null, evidence: `HTTP ${status}` }
    },
  },
  {
    id: 'diigo',
    name: 'Diigo',
    domain: 'diigo.com',
    method: 'register',
    request: (email) => ({
      url: `https://www.diigo.com/user_mana2/check_email?email=${encodeURIComponent(email)}`,
      method: 'GET',
      headers: { 'x-requested-with': 'XMLHttpRequest', referer: 'https://www.diigo.com/sign-up?plan=free' },
    }),
    interpret: (status, body) => {
      if (status !== 200) return { exists: null, evidence: `HTTP ${status}` }
      if (body.trim() === '0') return { exists: true, evidence: 'Diigo check_email 0 (taken)' }
      return { exists: false, evidence: `Diigo check_email ${body.trim() || 'non-zero'}` }
    },
  },
  {
    id: 'tellonym',
    name: 'Tellonym',
    domain: 'tellonym.me',
    method: 'register',
    request: (email) => ({
      url: `https://api.tellonym.me/accounts/check?email=${encodeURIComponent(email)}&limit=25`,
      method: 'GET',
      headers: {
        accept: 'application/json',
        'tellonym-client': 'web:0.51.1',
        origin: 'https://tellonym.me',
        referer: 'https://tellonym.me/register/email',
      },
    }),
    interpret: (status, body) => {
      if (/EMAIL_ALREADY_IN_USE/i.test(body)) return { exists: true, evidence: 'Tellonym EMAIL_ALREADY_IN_USE' }
      if (status === 200) return { exists: false, evidence: 'Tellonym check 200 without EMAIL_ALREADY_IN_USE' }
      return { exists: null, evidence: `HTTP ${status}` }
    },
  },
  {
    id: 'vsco',
    name: 'VSCO',
    domain: 'vsco.co',
    method: 'register',
    request: (email) => ({
      url: `https://api.vsco.co/2.0/users/email?email=${encodeURIComponent(email)}`,
      method: 'GET',
      headers: { authorization: 'Bearer 7356455548d0a1d886db010883388d08be84d0c9' },
    }),
    interpret: (status, body) => {
      if (status === 401 || status === 403) return { exists: null, evidence: `VSCO auth ${status}` }
      try {
        const parsed = JSON.parse(body) as { email_status?: string }
        if (parsed.email_status === 'has_account') return { exists: true, evidence: 'VSCO email_status has_account' }
        if (parsed.email_status === 'no_account') return { exists: false, evidence: 'VSCO email_status no_account' }
        return { exists: null, evidence: `VSCO email_status ${parsed.email_status ?? status}` }
      } catch {
        return { exists: null, evidence: `HTTP ${status}` }
      }
    },
  },
  {
    id: 'sporcle',
    name: 'Sporcle',
    domain: 'sporcle.com',
    method: 'register',
    request: (email) => ({
      url: 'https://www.sporcle.com/auth/ajax/verify.php',
      method: 'POST',
      headers: { ...FORM_HDR, 'x-requested-with': 'XMLHttpRequest', origin: 'https://www.sporcle.com' },
      body: `email=${encodeURIComponent(email)}&password1=&password2=&handle=&humancheck=&reg_path=main_header_join`,
    }),
    interpret: (status, body) => takenIf(body, /account already exists with this email/i, 'Sporcle: account already exists', status),
  },
  {
    id: 'rambler',
    name: 'Rambler',
    domain: 'rambler.ru',
    method: 'register',
    request: (email) => ({
      url: 'https://id.rambler.ru/jsonrpc',
      method: 'POST',
      headers: { ...JSON_HDR, origin: 'https://id.rambler.ru', referer: 'https://id.rambler.ru/champ/registration' },
      body: JSON.stringify({ method: 'Rambler::Id::get_email_account_info', params: [{ email }], rpc: '2.0' }),
    }),
    interpret: (status, body) => {
      const limited = rateLimitStatus(status)
      if (limited) return limited
      try {
        const parsed = JSON.parse(body) as { result?: { exists?: number } }
        if (parsed.result?.exists === 0) return { exists: false, evidence: 'Rambler exists 0' }
        if (parsed.result && parsed.result.exists !== 0) return { exists: true, evidence: 'Rambler exists non-zero' }
        return { exists: null, evidence: `HTTP ${status} inconclusive` }
      } catch {
        return { exists: null, evidence: `HTTP ${status}` }
      }
    },
  },
  {
    id: 'komoot',
    name: 'Komoot',
    domain: 'komoot.com',
    method: 'register',
    request: (email) => ({
      url: 'https://account.komoot.com/v1/signin',
      method: 'POST',
      headers: { ...JSON_HDR, origin: 'https://account.komoot.com', referer: 'https://account.komoot.com/signin' },
      body: JSON.stringify({ email }),
    }),
    interpret: (status, body) => {
      try {
        const parsed = JSON.parse(body) as { type?: string }
        if (parsed.type === 'login') return { exists: true, evidence: 'Komoot signin type login' }
        if (parsed.type) return { exists: false, evidence: `Komoot signin type ${parsed.type}` }
        return { exists: null, evidence: `HTTP ${status}` }
      } catch {
        return { exists: null, evidence: `HTTP ${status}` }
      }
    },
  },
  {
    id: 'nike',
    name: 'Nike',
    domain: 'nike.com',
    method: 'register',
    request: (email) => ({
      url: 'https://unite.nike.com/account/email/v1?appVersion=831&experienceVersion=831&uxid=com.nike.commerce.nikedotcom.web&locale=en_US&backendEnvironment=identity&mobile=false&native=false&visit=1',
      method: 'POST',
      headers: {
        'content-type': 'text/plain;charset=UTF-8',
        origin: 'https://www.nike.com',
        referer: 'https://www.nike.com/',
      },
      body: JSON.stringify({ emailAddress: email }),
    }),
    interpret: (status) => {
      if (status === 409) return { exists: true, evidence: 'Nike email endpoint 409 (taken)' }
      if (status === 204) return { exists: false, evidence: 'Nike email endpoint 204 (available)' }
      return { exists: null, evidence: `HTTP ${status}` }
    },
  },
  {
    id: 'adobe',
    name: 'Adobe',
    domain: 'adobe.com',
    method: 'login',
    request: (email) => ({
      url: 'https://auth.services.adobe.com/signin/v1/authenticationstate',
      method: 'POST',
      headers: { ...JSON_HDR, 'x-ims-clientid': 'adobedotcom2', origin: 'https://auth.services.adobe.com' },
      body: JSON.stringify({ username: email, accountType: 'individual' }),
    }),
    interpret: (status, body) => {
      // Login-state only — never follow Adobe's passwordRecovery challenge.
      if (/errorCode/i.test(body)) return { exists: false, evidence: 'Adobe authenticationstate errorCode (unknown user)' }
      if (status === 200) return { exists: true, evidence: 'Adobe authenticationstate 200 (account recognized)' }
      return { exists: null, evidence: `HTTP ${status}` }
    },
  },
  {
    id: 'archive',
    name: 'Internet Archive',
    domain: 'archive.org',
    method: 'register',
    request: (email) => ({
      url: 'https://archive.org/account/signup',
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        origin: 'https://archive.org',
        referer: 'https://archive.org/account/signup',
      },
      body: `input_name=username&input_value=${encodeURIComponent(email)}&input_validator=true&submit_by_js=true`,
    }),
    interpret: (status, body) => takenIf(body, /is already taken/i, 'Archive.org: already taken', status),
  },
  {
    id: 'wattpad',
    name: 'Wattpad',
    domain: 'wattpad.com',
    method: 'register',
    request: (email) => ({
      url: `https://www.wattpad.com/api/v3/users/validate?email=${encodeURIComponent(email)}`,
      method: 'GET',
      headers: { 'x-requested-with': 'XMLHttpRequest', referer: 'https://www.wattpad.com/' },
    }),
    interpret: (status, body) => {
      if (status !== 200 && status !== 400) return { exists: null, evidence: `HTTP ${status}` }
      if (/already/i.test(body) && !/"code":200/.test(body)) {
        return { exists: true, evidence: 'Wattpad validate: already registered' }
      }
      if (/"code":200|"message":"OK"/i.test(body)) return { exists: false, evidence: 'Wattpad validate OK' }
      return { exists: null, evidence: `HTTP ${status} inconclusive` }
    },
  },
  {
    id: 'microsoft',
    name: 'Microsoft account',
    domain: 'live.com',
    method: 'login',
    request: (email) => ({
      url: 'https://login.live.com/GetCredentialType.srf',
      method: 'POST',
      headers: JSON_HDR,
      body: JSON.stringify({
        username: email,
        uaid: '',
        isOtherIdpSupported: true,
        checkPhones: false,
        isRemoteNGCSupported: true,
        isCookieBannerShown: false,
        isFidoSupported: true,
        forceotclogin: false,
        otclogindisallowed: false,
        isExternalFederationProvider: true,
      }),
    }),
    interpret: interpretMicrosoftLive,
  },
  {
    id: 'microsoft_realm',
    name: 'Microsoft 365 realm',
    domain: 'microsoftonline.com',
    method: 'other',
    request: (email) => ({
      url: `https://login.microsoftonline.com/getuserrealm.srf?login=${encodeURIComponent(email)}&xml=0`,
      method: 'GET',
      headers: { accept: 'application/json' },
    }),
    interpret: interpretMicrosoftRealm,
  },
  {
    id: 'skype',
    name: 'Skype',
    domain: 'skype.com',
    method: 'other',
    request: (email) => ({
      url: `https://login.skype.com/json/users/exists?username=${encodeURIComponent(email)}`,
      method: 'GET',
      headers: { accept: 'application/json' },
    }),
    interpret: (status, body) => {
      try {
        const parsed = JSON.parse(body) as { statusjson?: { exists?: boolean }; exists?: boolean }
        const exists = parsed.statusjson?.exists ?? parsed.exists
        if (exists === true) return { exists: true, evidence: 'Skype users/exists true' }
        if (exists === false) return { exists: false, evidence: 'Skype users/exists false' }
        return { exists: null, evidence: `HTTP ${status}` }
      } catch {
        return { exists: null, evidence: `HTTP ${status}` }
      }
    },
  },
  {
    id: 'protonmail',
    name: 'Proton Mail',
    domain: 'proton.me',
    method: 'other',
    request: (email) => ({
      url: `https://api.protonmail.ch/pks/lookup?op=index&search=${encodeURIComponent(email)}`,
      method: 'GET',
    }),
    interpret: interpretProtonmail,
  },
  {
    id: 'freelancer',
    name: 'Freelancer',
    domain: 'freelancer.com',
    method: 'register',
    request: (email) => ({
      url: 'https://www.freelancer.com/api/users/0.1/users/check?compact=true&new_errors=true',
      method: 'POST',
      headers: { ...JSON_HDR, origin: 'https://www.freelancer.com' },
      body: JSON.stringify({ user: { email } }),
    }),
    interpret: interpretFreelancer,
  },
  {
    id: 'hubspot',
    name: 'HubSpot',
    domain: 'hubspot.com',
    method: 'login',
    request: (email) => ({
      url: 'https://api.hubspot.com/login-api/v1/login',
      method: 'POST',
      headers: { ...JSON_HDR, origin: 'https://app.hubspot.com', referer: 'https://app.hubspot.com/' },
      body: JSON.stringify({ email, password: '', rememberLogin: false }),
    }),
    interpret: interpretHubspot,
  },
  {
    id: 'amocrm',
    name: 'amoCRM',
    domain: 'amocrm.com',
    method: 'register',
    request: (email) => ({
      url: 'https://www.amocrm.com/account/check_login.php',
      method: 'POST',
      headers: { ...FORM_HDR, 'x-requested-with': 'XMLHttpRequest', origin: 'https://www.amocrm.com' },
      body: `LOGIN=${encodeURIComponent(email)}`,
    }),
    interpret: (status, body) => {
      try {
        const parsed = JSON.parse(body) as { status?: string }
        if (parsed.status === 'used') return { exists: true, evidence: 'amoCRM login status used' }
        if (parsed.status === 'free') return { exists: false, evidence: 'amoCRM login status free' }
        return { exists: null, evidence: `amoCRM status ${parsed.status ?? status}` }
      } catch {
        return { exists: null, evidence: `HTTP ${status}` }
      }
    },
  },
  {
    id: 'voxmedia',
    name: 'Vox Media',
    domain: 'voxmedia.com',
    method: 'register',
    request: (email) => ({
      url: 'https://auth.voxmedia.com/chorus_auth/email_valid.json',
      method: 'POST',
      headers: { ...FORM_HDR, 'x-requested-with': 'XMLHttpRequest', origin: 'https://auth.voxmedia.com' },
      body: `email=${encodeURIComponent(email)}`,
    }),
    interpret: (status, body) => {
      try {
        const parsed = JSON.parse(body) as { available?: boolean; message?: string }
        if (parsed.available === true) return { exists: false, evidence: 'Vox email_valid available true' }
        if (parsed.available === false) return { exists: true, evidence: 'Vox email_valid available false' }
        return { exists: null, evidence: `HTTP ${status}` }
      } catch {
        return { exists: null, evidence: `HTTP ${status}` }
      }
    },
  },
  {
    id: 'vrbo',
    name: 'Vrbo',
    domain: 'vrbo.com',
    method: 'register',
    request: (email) => ({
      url: 'https://www.vrbo.com/auth/aam/v3/status',
      method: 'POST',
      headers: { ...JSON_HDR, 'x-homeaway-site': 'vrbo', origin: 'https://www.vrbo.com' },
      body: JSON.stringify({ emailAddress: email }),
    }),
    interpret: (status, body) => {
      try {
        const parsed = JSON.parse(body) as { authType?: string[] }
        const kind = parsed.authType?.[0]
        if (kind === 'LOGIN_UMS') return { exists: true, evidence: 'Vrbo authType LOGIN_UMS' }
        if (kind === 'SIGNUP') return { exists: false, evidence: 'Vrbo authType SIGNUP' }
        return { exists: null, evidence: `Vrbo authType ${kind ?? status}` }
      } catch {
        return { exists: null, evidence: `HTTP ${status}` }
      }
    },
  },
  {
    id: 'pipedrive',
    name: 'Pipedrive',
    domain: 'pipedrive.com',
    method: 'register',
    request: (email) => ({
      url: 'https://app.pipedrive.com/signup-service/start',
      method: 'POST',
      headers: { ...JSON_HDR, origin: 'https://www.pipedrive.com' },
      body: JSON.stringify({ email, language: 'en', country_code: 'us', selectedTier: null, packages: [] }),
    }),
    interpret: (status, body) => {
      if (/Email is not available/i.test(body)) return { exists: true, evidence: 'Pipedrive email is not available' }
      try {
        const parsed = JSON.parse(body) as { data?: { redirectUrl?: string } }
        if (parsed.data?.redirectUrl?.includes('signup-service')) {
          return { exists: false, evidence: 'Pipedrive signup redirect (email free)' }
        }
      } catch {
        /* fall through */
      }
      return { exists: null, evidence: `HTTP ${status}` }
    },
  },
  {
    id: 'fanpop',
    name: 'Fanpop',
    domain: 'fanpop.com',
    method: 'register',
    request: (email) => ({
      url: 'https://www.fanpop.com/login/superlogin',
      method: 'POST',
      headers: { ...FORM_HDR, 'x-requested-with': 'XMLHttpRequest', origin: 'https://www.fanpop.com' },
      body: `type=register&user%5Bname%5D=&user%5Bpassword%5D=&user%5Bemail%5D=${encodeURIComponent(email)}&submissiontype=register`,
    }),
    interpret: (status, body) => takenIf(body, /already registered/i, 'Fanpop: already registered', status),
  },
  {
    id: 'parler',
    name: 'Parler',
    domain: 'parler.com',
    method: 'login',
    request: (email) => ({
      url: 'https://api.parler.com/v2/login/new',
      method: 'POST',
      headers: { ...JSON_HDR, origin: 'https://parler.com' },
      body: JSON.stringify({
        identifier: email,
        password: 'invalidpasswordfortest',
        deviceId: Math.random().toString(36).slice(2, 18),
      }),
    }),
    interpret: (status, body) => {
      if (/password/i.test(body) && !/unknown|not found|no user/i.test(body)) {
        return { exists: true, evidence: 'Parler login mentioned password (account exists)' }
      }
      if (status === 200 || status === 400) return { exists: false, evidence: 'Parler login without password-exists marker' }
      return { exists: null, evidence: `HTTP ${status}` }
    },
  },
  {
    id: 'axonaut',
    name: 'Axonaut',
    domain: 'axonaut.com',
    method: 'register',
    request: (email) => ({
      url: `https://axonaut.com/onboarding/?email=${encodeURIComponent(email)}`,
      method: 'GET',
      followRedirects: false,
    }),
    interpret: (status, _body, ctx) => {
      const location = ctx?.headers.location ?? ctx?.finalUrl ?? ''
      if ((status === 302 || status === 301) && /\/login\?email/i.test(location)) {
        return { exists: true, evidence: 'Axonaut onboarding redirected to login' }
      }
      if (status === 200) return { exists: false, evidence: 'Axonaut onboarding 200 (signup)' }
      return { exists: null, evidence: `HTTP ${status}` }
    },
  },
  {
    id: 'devrant',
    name: 'devRant',
    domain: 'devrant.com',
    method: 'register',
    request: (email) => ({
      url: 'https://devrant.com/api/users',
      method: 'POST',
      headers: { ...FORM_HDR, 'x-requested-with': 'XMLHttpRequest', origin: 'https://devrant.com' },
      body: `app=3&type=1&email=${encodeURIComponent(email)}&username=&password=&guid=&plat=3&sid=&seid=`,
    }),
    interpret: (status, body) => {
      if (/already registered/i.test(body)) return { exists: true, evidence: 'devRant email already registered' }
      if (status === 200 || status === 400) return { exists: false, evidence: 'devRant register without already-registered' }
      return { exists: null, evidence: `HTTP ${status}` }
    },
  },
  {
    id: 'blip',
    name: 'Blip.fm',
    domain: 'blip.fm',
    method: 'register',
    request: (email) => ({
      url: 'https://blip.fm/signup/save',
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', origin: 'https://blip.fm', referer: 'https://blip.fm/' },
      body: `genpass=1&signup%5BurlName%5D=test&signup%5BemailAddress%5D=${encodeURIComponent(email)}&tos=0`,
    }),
    interpret: (status, body) => {
      if (/already in use/i.test(body)) return { exists: true, evidence: 'Blip.fm email already in use' }
      if (/spinner\.gif/i.test(body)) return { exists: null, evidence: 'Blip.fm captcha/spinner', rateLimited: true }
      if (status === 200) return { exists: false, evidence: 'Blip.fm signup 200 without taken marker' }
      return { exists: null, evidence: `HTTP ${status}` }
    },
  },
  {
    id: 'ello',
    name: 'Ello',
    domain: 'ello.co',
    method: 'register',
    request: (email) => ({
      url: 'https://ello.co/api/v2/availability',
      method: 'POST',
      headers: { ...JSON_HDR, origin: 'https://ello.co', referer: 'https://ello.co/join' },
      body: JSON.stringify({ email }),
    }),
    interpret: (status, body) => {
      try {
        const parsed = JSON.parse(body) as { availability?: { email?: boolean } }
        if (parsed.availability?.email === true) return { exists: false, evidence: 'Ello availability.email true' }
        if (parsed.availability?.email === false) return { exists: true, evidence: 'Ello availability.email false (taken)' }
        return { exists: null, evidence: `HTTP ${status}` }
      } catch {
        return { exists: null, evidence: `HTTP ${status}` }
      }
    },
  },
]

export const HOLEHE_EMAIL_MODULES = EMAIL_MODULES.filter((m) => m.id !== 'gravatar')
