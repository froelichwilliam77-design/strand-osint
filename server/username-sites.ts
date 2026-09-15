import type { PresenceOutcome, UsernameSite } from './presence.ts'

const NOT_FOUND = /page not found|doesn'?t exist|user not found|couldn'?t find|not found|no such user|sorry, this page isn'?t available|this account doesn'?t exist|could not find/i

export function interpretJsonUser(
  status: number,
  body: string,
  pick: (parsed: Record<string, unknown>) => { exists: boolean; extra?: string } | null,
  labels: { yes: string; no: string },
): PresenceOutcome {
  if (status === 404) return { exists: false, evidence: 'HTTP 404' }
  if (status === 429) return { exists: null, evidence: 'rate limited (429)', rateLimited: true }
  try {
    const parsed = JSON.parse(body) as Record<string, unknown>
    const hit = pick(parsed)
    if (hit?.exists) return { exists: true, evidence: labels.yes, extra: hit.extra }
    if (hit && hit.exists === false) return { exists: false, evidence: labels.no }
    if (status === 200) return { exists: null, evidence: 'JSON 200 without a clear exists marker' }
    return { exists: null, evidence: `HTTP ${status}` }
  } catch {
    return { exists: null, evidence: `HTTP ${status}` }
  }
}

export function interpretStrictProfile(status: number, body: string, finalUrl: string, marker: RegExp): PresenceOutcome {
  if (status === 404) return { exists: false, evidence: 'HTTP 404' }
  if (status === 429 || status === 403) {
    return { exists: null, evidence: `HTTP ${status} (rate limit or wall)`, rateLimited: status === 429 }
  }
  if (NOT_FOUND.test(body)) return { exists: false, evidence: 'not-found copy' }
  if (status === 200 && marker.test(body) && !/\/login/i.test(finalUrl)) {
    return { exists: true, evidence: 'profile/page markers' }
  }
  if (status === 200) return { exists: null, evidence: 'HTTP 200 without a clear profile marker' }
  return { exists: null, evidence: `HTTP ${status}` }
}

/** Sites that 404 missing users (API or HTML). Bare 200 is a hit only after not-found copy is ruled out. */
export function interpretApiOr404(status: number, body: string, nameMarker?: RegExp): PresenceOutcome {
  if (status === 404) return { exists: false, evidence: 'HTTP 404' }
  if (status === 429) return { exists: null, evidence: 'rate limited (429)', rateLimited: true }
  if (status === 403) return { exists: null, evidence: 'HTTP 403', rateLimited: true }
  if (NOT_FOUND.test(body) && status === 200) return { exists: false, evidence: 'not-found copy on HTTP 200' }
  if (status === 200) {
    if (nameMarker && !nameMarker.test(body)) return { exists: null, evidence: 'HTTP 200 without expected payload' }
    return { exists: true, evidence: 'HTTP 200' }
  }
  return { exists: null, evidence: `HTTP ${status}` }
}

export const USERNAME_SITES: UsernameSite[] = [
  {
    id: 'github',
    name: 'GitHub',
    url: (u) => `https://api.github.com/users/${encodeURIComponent(u)}`,
    profileUrl: (u) => `https://github.com/${encodeURIComponent(u)}`,
    headers: { accept: 'application/vnd.github+json' },
    interpret: (status, body) => {
      if (status === 404) return { exists: false, evidence: 'GitHub users API 404' }
      if (status === 403 || status === 429) return { exists: null, evidence: `rate limited (${status})`, rateLimited: true }
      if (status === 200) {
        try {
          const parsed = JSON.parse(body) as { login?: string; html_url?: string; type?: string }
          if (parsed.login) {
            return { exists: true, evidence: `GitHub ${parsed.type || 'user'} ${parsed.login}`, extra: parsed.login }
          }
        } catch {
          return { exists: null, evidence: 'GitHub users JSON unreadable' }
        }
        return { exists: true, evidence: 'GitHub users API 200' }
      }
      return { exists: null, evidence: `HTTP ${status}` }
    },
  },
  {
    id: 'gitlab',
    name: 'GitLab',
    url: (u) => `https://gitlab.com/api/v4/users?username=${encodeURIComponent(u)}`,
    profileUrl: (u) => `https://gitlab.com/${encodeURIComponent(u)}`,
    interpret: (status, body) => {
      if (status === 404) return { exists: false, evidence: 'HTTP 404' }
      if (status !== 200) return { exists: null, evidence: `HTTP ${status}` }
      try {
        const parsed = JSON.parse(body) as Array<{ username?: string }>
        if (Array.isArray(parsed) && parsed.length > 0) {
          return { exists: true, evidence: `GitLab users API matched ${parsed[0]?.username ?? 'user'}`, extra: parsed[0]?.username }
        }
        return { exists: false, evidence: 'GitLab users API empty list' }
      } catch {
        return { exists: null, evidence: 'GitLab JSON unreadable' }
      }
    },
  },
  {
    id: 'bitbucket',
    name: 'Bitbucket',
    url: (u) => `https://api.bitbucket.org/2.0/users/${encodeURIComponent(u)}`,
    profileUrl: (u) => `https://bitbucket.org/${encodeURIComponent(u)}`,
    interpret: (status, body) => interpretApiOr404(status, body, /"username"|display_name|account_id/),
  },
  {
    id: 'codeberg',
    name: 'Codeberg',
    url: (u) => `https://codeberg.org/${encodeURIComponent(u)}`,
    interpret: (status, body, finalUrl) => interpretStrictProfile(status, body, finalUrl, /og:type|vcard|itemprop="name"/i),
  },
  {
    id: 'sourcehut',
    name: 'SourceHut',
    url: (u) => `https://sr.ht/~${encodeURIComponent(u)}`,
    interpret: (status, body, finalUrl) => interpretStrictProfile(status, body, finalUrl, /sourcehut|~[A-Za-z0-9]/i),
  },
  {
    id: 'reddit',
    name: 'Reddit',
    url: (u) => `https://www.reddit.com/user/${encodeURIComponent(u)}/about.json`,
    profileUrl: (u) => `https://www.reddit.com/user/${encodeURIComponent(u)}`,
    interpret: (status, body) => {
      if (status === 404) return { exists: false, evidence: 'HTTP 404' }
      if (status === 429 || status === 403) return { exists: null, evidence: `rate limited (${status})`, rateLimited: true }
      if (status === 200) {
        try {
          const parsed = JSON.parse(body) as { kind?: string; data?: { name?: string }; error?: number }
          if (parsed.error === 404) return { exists: false, evidence: 'Reddit error 404' }
          if (parsed.data?.name) return { exists: true, evidence: `Reddit user ${parsed.data.name}`, extra: parsed.data.name }
        } catch {
          return { exists: null, evidence: 'Reddit JSON unreadable' }
        }
        return { exists: true, evidence: 'HTTP 200 about.json' }
      }
      return { exists: null, evidence: `HTTP ${status}` }
    },
  },
  {
    id: 'hackernews',
    name: 'Hacker News',
    url: (u) => `https://news.ycombinator.com/user?id=${encodeURIComponent(u)}`,
    interpret: (status, body) => {
      if (status === 404 || /No such user/i.test(body)) return { exists: false, evidence: 'No such user' }
      if (status === 200 && /karma/i.test(body)) return { exists: true, evidence: 'HN user page with karma' }
      if (status === 200) return { exists: null, evidence: 'HN page without karma marker' }
      return { exists: null, evidence: `HTTP ${status}` }
    },
  },
  {
    id: 'keybase',
    name: 'Keybase',
    url: (u) => `https://keybase.io/_/api/1.0/user/lookup.json?username=${encodeURIComponent(u)}`,
    profileUrl: (u) => `https://keybase.io/${encodeURIComponent(u)}`,
    interpret: (status, body) => {
      if (status !== 200) return { exists: null, evidence: `HTTP ${status}` }
      try {
        const parsed = JSON.parse(body) as { status?: { code?: number }; them?: unknown[] }
        if (parsed.status?.code === 205) return { exists: false, evidence: 'Keybase username 205' }
        if (parsed.status?.code === 0 && Array.isArray(parsed.them) && parsed.them.length > 0) {
          return { exists: true, evidence: 'Keybase username lookup matched' }
        }
        return { exists: false, evidence: 'Keybase username lookup empty' }
      } catch {
        return { exists: null, evidence: 'Keybase JSON unreadable' }
      }
    },
  },
  {
    id: 'npm',
    name: 'npm',
    url: (u) => `https://www.npmjs.com/~${encodeURIComponent(u)}`,
    interpret: (status, body, finalUrl) => interpretStrictProfile(status, body, finalUrl, /npmjs|packages by|og:title/i),
  },
  {
    id: 'pypi',
    name: 'PyPI',
    url: (u) => `https://pypi.org/user/${encodeURIComponent(u)}/`,
    interpret: (status, body, finalUrl) => interpretStrictProfile(status, body, finalUrl, /pypi|packages|og:title/i),
  },
  {
    id: 'crates',
    name: 'crates.io',
    url: (u) => `https://crates.io/api/v1/users/${encodeURIComponent(u)}`,
    profileUrl: (u) => `https://crates.io/users/${encodeURIComponent(u)}`,
    headers: { accept: 'application/json' },
    interpret: (status, body) => interpretApiOr404(status, body, /"user"|login|name/),
  },
  {
    id: 'dockerhub',
    name: 'Docker Hub',
    url: (u) => `https://hub.docker.com/v2/users/${encodeURIComponent(u)}/`,
    profileUrl: (u) => `https://hub.docker.com/u/${encodeURIComponent(u)}`,
    interpret: (status, body) => interpretApiOr404(status, body, /username|full_name|uuid/),
  },
  {
    id: 'huggingface',
    name: 'Hugging Face',
    url: (u) => `https://huggingface.co/${encodeURIComponent(u)}`,
    interpret: (status, body, finalUrl) => interpretStrictProfile(status, body, finalUrl, /huggingface|og:title|avatar/i),
  },
  {
    id: 'replit',
    name: 'Replit',
    url: (u) => `https://replit.com/@${encodeURIComponent(u)}`,
    interpret: (status, body, finalUrl) => interpretStrictProfile(status, body, finalUrl, /og:title|profile|@/i),
  },
  {
    id: 'codepen',
    name: 'CodePen',
    url: (u) => `https://codepen.io/${encodeURIComponent(u)}`,
    interpret: (status, body, finalUrl) => interpretStrictProfile(status, body, finalUrl, /og:title|profile/i),
  },
  {
    id: 'devto',
    name: 'Dev.to',
    url: (u) => `https://dev.to/${encodeURIComponent(u)}`,
    interpret: (status, body, finalUrl) => interpretStrictProfile(status, body, finalUrl, /og:type|profile|DEV Community/i),
  },
  {
    id: 'hashnode',
    name: 'Hashnode',
    url: (u) => `https://hashnode.com/@${encodeURIComponent(u)}`,
    interpret: (status, body, finalUrl) => interpretStrictProfile(status, body, finalUrl, /og:title|hashnode/i),
  },
  {
    id: 'medium',
    name: 'Medium',
    url: (u) => `https://medium.com/@${encodeURIComponent(u)}`,
    interpret: (status, body, finalUrl) => interpretStrictProfile(status, body, finalUrl, /og:type" content="profile"|profile:username/i),
  },
  {
    id: 'producthunt',
    name: 'Product Hunt',
    url: (u) => `https://www.producthunt.com/@${encodeURIComponent(u)}`,
    interpret: (status, body, finalUrl) => interpretStrictProfile(status, body, finalUrl, /og:title|Product Hunt/i),
  },
  {
    id: 'lobsters',
    name: 'Lobsters',
    url: (u) => `https://lobste.rs/u/${encodeURIComponent(u)}`,
    interpret: (status, body, finalUrl) => interpretStrictProfile(status, body, finalUrl, /joined|karma|lobste/i),
  },
  {
    id: 'lemmy',
    name: 'Lemmy',
    url: (u) => `https://lemmy.world/u/${encodeURIComponent(u)}`,
    interpret: (status, body, finalUrl) => interpretStrictProfile(status, body, finalUrl, /og:title|lemmy/i),
  },
  {
    id: 'mastodon',
    name: 'Mastodon',
    url: (u) => `https://mastodon.social/@${encodeURIComponent(u)}`,
    interpret: (status, body, finalUrl) => interpretStrictProfile(status, body, finalUrl, /og:type" content="profile"|mastodon/i),
  },
  {
    id: 'bluesky',
    name: 'Bluesky',
    url: (u) => {
      const actor = u.includes('.') ? u : `${u}.bsky.social`
      return `https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile?actor=${encodeURIComponent(actor)}`
    },
    profileUrl: (u) => {
      const actor = u.includes('.') ? u : `${u}.bsky.social`
      return `https://bsky.app/profile/${encodeURIComponent(actor)}`
    },
    interpret: (status, body) => {
      if (status === 400 || status === 404) return { exists: false, evidence: `Bluesky ${status}` }
      if (status !== 200) return { exists: null, evidence: `HTTP ${status}` }
      try {
        const parsed = JSON.parse(body) as { handle?: string; did?: string }
        if (parsed.did || parsed.handle) {
          return { exists: true, evidence: `Bluesky ${parsed.handle || parsed.did}`, extra: parsed.handle }
        }
        return { exists: null, evidence: 'Bluesky JSON missing handle' }
      } catch {
        return { exists: null, evidence: 'Bluesky JSON unreadable' }
      }
    },
  },
  {
    id: 'telegram',
    name: 'Telegram',
    url: (u) => `https://t.me/${encodeURIComponent(u)}`,
    interpret: (status, body) => {
      if (status === 404) return { exists: false, evidence: 'HTTP 404' }
      if (/If you have .+ installed/i.test(body) && /tg:\/\/resolve/i.test(body)) {
        return { exists: true, evidence: 'Telegram resolve page' }
      }
      if (status === 200) return { exists: null, evidence: 'Telegram 200 without resolve marker' }
      return { exists: null, evidence: `HTTP ${status}` }
    },
  },
  {
    id: 'twitch',
    name: 'Twitch',
    url: (u) => `https://www.twitch.tv/${encodeURIComponent(u)}`,
    interpret: (status, body) => {
      if (status === 404) return { exists: false, evidence: 'HTTP 404' }
      if (/Sorry\. Unless you.?ve got a time machine/i.test(body)) return { exists: false, evidence: 'Twitch missing-channel page' }
      if (status === 200 && /og:type" content="profile"/i.test(body)) return { exists: true, evidence: 'Twitch og:type profile' }
      if (status === 200) return { exists: null, evidence: 'Twitch 200 without profile marker (login wall possible)' }
      return { exists: null, evidence: `HTTP ${status}` }
    },
  },
  {
    id: 'youtube',
    name: 'YouTube',
    url: (u) => `https://www.youtube.com/@${encodeURIComponent(u)}`,
    interpret: (status, body) => {
      if (status === 404) return { exists: false, evidence: 'HTTP 404' }
      if (/This page isn't available|This channel doesn't exist/i.test(body)) {
        return { exists: false, evidence: 'YouTube missing-channel copy' }
      }
      if (status === 200 && /subscriber/i.test(body)) return { exists: true, evidence: 'channel page mentions subscribers' }
      if (status === 200) return { exists: null, evidence: 'YouTube 200 without subscriber marker (login wall possible)' }
      return { exists: null, evidence: `HTTP ${status}` }
    },
  },
  {
    id: 'soundcloud',
    name: 'SoundCloud',
    url: (u) => `https://soundcloud.com/${encodeURIComponent(u)}`,
    interpret: (status, body) => {
      if (status === 404) return { exists: false, evidence: 'HTTP 404' }
      if (/We can.?t find that user|page not found/i.test(body)) return { exists: false, evidence: 'SoundCloud missing user' }
      if (status === 200 && /og:type" content="profile"/i.test(body)) return { exists: true, evidence: 'SoundCloud profile og:type' }
      if (status === 200) return { exists: null, evidence: 'SoundCloud 200 without profile marker' }
      return { exists: null, evidence: `HTTP ${status}` }
    },
  },
  {
    id: 'lastfm',
    name: 'Last.fm',
    url: (u) => `https://www.last.fm/user/${encodeURIComponent(u)}`,
    interpret: (status, body, finalUrl) => interpretStrictProfile(status, body, finalUrl, /og:type" content="profile"|scrobble|last\.fm/i),
  },
  {
    id: 'spotify',
    name: 'Spotify',
    url: (u) => `https://open.spotify.com/user/${encodeURIComponent(u)}`,
    interpret: (status, body, finalUrl) => interpretStrictProfile(status, body, finalUrl, /og:title|Spotify/i),
  },
  {
    id: 'vimeo',
    name: 'Vimeo',
    url: (u) => `https://vimeo.com/${encodeURIComponent(u)}`,
    interpret: (status, body, finalUrl) => interpretStrictProfile(status, body, finalUrl, /og:type|profile/i),
  },
  {
    id: 'flickr',
    name: 'Flickr',
    url: (u) => `https://www.flickr.com/people/${encodeURIComponent(u)}/`,
    interpret: (status, body, finalUrl) => interpretStrictProfile(status, body, finalUrl, /og:type" content="profile"|flickr/i),
  },
  {
    id: 'deviantart',
    name: 'DeviantArt',
    url: (u) => `https://www.deviantart.com/${encodeURIComponent(u)}`,
    interpret: (status, body, finalUrl) => interpretStrictProfile(status, body, finalUrl, /og:title|deviantart/i),
  },
  {
    id: 'behance',
    name: 'Behance',
    url: (u) => `https://www.behance.net/${encodeURIComponent(u)}`,
    interpret: (status, body, finalUrl) => interpretStrictProfile(status, body, finalUrl, /og:title|Behance/i),
  },
  {
    id: 'dribbble',
    name: 'Dribbble',
    url: (u) => `https://dribbble.com/${encodeURIComponent(u)}`,
    interpret: (status, body, finalUrl) => interpretStrictProfile(status, body, finalUrl, /og:title|Dribbble/i),
  },
  {
    id: 'pinterest',
    name: 'Pinterest',
    url: (u) => `https://www.pinterest.com/${encodeURIComponent(u)}/`,
    interpret: (status, body, finalUrl) => interpretStrictProfile(status, body, finalUrl, /og:type" content="profile"|pinterest/i),
  },
  {
    id: 'tumblr',
    name: 'Tumblr',
    url: (u) => `https://${encodeURIComponent(u)}.tumblr.com/`,
    interpret: (status, body, finalUrl) => interpretStrictProfile(status, body, finalUrl, /tumblr|og:title/i),
  },
  {
    id: 'linktree',
    name: 'Linktree',
    url: (u) => `https://linktr.ee/${encodeURIComponent(u)}`,
    interpret: (status, body, finalUrl) => {
      if (status === 404) return { exists: false, evidence: 'HTTP 404' }
      if (/page not found|doesn't exist|couldn'?t find/i.test(body)) return { exists: false, evidence: 'not-found copy' }
      if (status === 200 && /linktr\.ee\/login/i.test(finalUrl)) return { exists: null, evidence: 'redirected to login' }
      if (status === 200 && /og:title/i.test(body) && !/linktree is the/i.test(body)) {
        return { exists: true, evidence: 'Linktree og:title on a named page' }
      }
      if (status === 200) return { exists: null, evidence: 'Linktree 200 without a clear profile' }
      return { exists: null, evidence: `HTTP ${status}` }
    },
  },
  {
    id: 'aboutme',
    name: 'About.me',
    url: (u) => `https://about.me/${encodeURIComponent(u)}`,
    interpret: (status, body) => {
      if (status === 404) return { exists: false, evidence: 'HTTP 404' }
      if (/page not found|doesn'?t exist|user not found/i.test(body)) return { exists: false, evidence: 'not-found copy' }
      if (status === 200 && /property="og:type"\s+content="profile"/i.test(body)) {
        return { exists: true, evidence: 'About.me og:type profile' }
      }
      if (status === 200) return { exists: null, evidence: 'About.me 200 without profile marker' }
      return { exists: null, evidence: `HTTP ${status}` }
    },
  },
  {
    id: 'buymeacoffee',
    name: 'Buy Me a Coffee',
    url: (u) => `https://www.buymeacoffee.com/${encodeURIComponent(u)}`,
    interpret: (status, body, finalUrl) => interpretStrictProfile(status, body, finalUrl, /buymeacoffee|og:title/i),
  },
  {
    id: 'kofi',
    name: 'Ko-fi',
    url: (u) => `https://ko-fi.com/${encodeURIComponent(u)}`,
    interpret: (status, body, finalUrl) => interpretStrictProfile(status, body, finalUrl, /ko-fi|og:title/i),
  },
  {
    id: 'patreon',
    name: 'Patreon',
    url: (u) => `https://www.patreon.com/${encodeURIComponent(u)}`,
    interpret: (status, body, finalUrl) => interpretStrictProfile(status, body, finalUrl, /og:title|Patreon/i),
  },
  {
    id: 'venmo',
    name: 'Venmo',
    url: (u) => `https://account.venmo.com/u/${encodeURIComponent(u)}`,
    interpret: (status, body, finalUrl) => interpretStrictProfile(status, body, finalUrl, /og:title|Venmo/i),
  },
  {
    id: 'cashapp',
    name: 'Cash App',
    url: (u) => `https://cash.app/$${encodeURIComponent(u)}`,
    interpret: (status, body, finalUrl) => interpretStrictProfile(status, body, finalUrl, /cash app|cashtag|og:title/i),
  },
  {
    id: 'paypal',
    name: 'PayPal.me',
    url: (u) => `https://www.paypal.me/${encodeURIComponent(u)}`,
    interpret: (status, body, finalUrl) => interpretStrictProfile(status, body, finalUrl, /paypal|og:title/i),
  },
  {
    id: 'snapchat',
    name: 'Snapchat',
    url: (u) => `https://www.snapchat.com/add/${encodeURIComponent(u)}`,
    interpret: (status, body, finalUrl) => interpretStrictProfile(status, body, finalUrl, /og:title|Snapchat/i),
  },
  {
    id: 'tiktok',
    name: 'TikTok',
    url: (u) => `https://www.tiktok.com/@${encodeURIComponent(u)}`,
    interpret: (status, body) => {
      if (status === 404) return { exists: false, evidence: 'HTTP 404' }
      if (/Couldn't find this account|page not found/i.test(body)) return { exists: false, evidence: 'TikTok missing account' }
      if (status === 200 && /og:type" content="profile"|uniqueId/i.test(body)) return { exists: true, evidence: 'TikTok profile markers' }
      if (status === 200) return { exists: null, evidence: 'TikTok 200 without profile marker' }
      return { exists: null, evidence: `HTTP ${status}` }
    },
  },
  {
    id: 'instagram',
    name: 'Instagram',
    url: (u) => `https://www.instagram.com/${encodeURIComponent(u)}/`,
    interpret: (status, body) => {
      if (status === 404) return { exists: false, evidence: 'HTTP 404' }
      if (/Sorry, this page isn'?t available/i.test(body)) return { exists: false, evidence: 'Instagram missing page' }
      if (status === 200 && /og:type" content="profile"|profilePage_/i.test(body)) {
        return { exists: true, evidence: 'Instagram profile markers' }
      }
      if (status === 200) return { exists: null, evidence: 'Instagram 200 without profile marker (login wall possible)' }
      return { exists: null, evidence: `HTTP ${status}` }
    },
  },
  {
    id: 'twitter',
    name: 'X / Twitter',
    url: (u) => `https://api.twitter.com/i/users/username_available.json?username=${encodeURIComponent(u)}`,
    profileUrl: (u) => `https://x.com/${encodeURIComponent(u)}`,
    interpret: (status, body) => {
      if (status === 401 || status === 403 || status === 429) {
        return { exists: null, evidence: `Twitter API ${status}`, rateLimited: true }
      }
      try {
        const parsed = JSON.parse(body) as { taken?: boolean; reason?: string; valid?: boolean }
        if (parsed.taken === true) return { exists: true, evidence: 'Twitter username_available taken:true' }
        if (parsed.taken === false || parsed.reason === 'available') {
          return { exists: false, evidence: 'Twitter username_available not taken' }
        }
        return { exists: null, evidence: 'Twitter username JSON inconclusive' }
      } catch {
        return { exists: null, evidence: `HTTP ${status}` }
      }
    },
  },
  {
    id: 'threads',
    name: 'Threads',
    url: (u) => `https://www.threads.net/@${encodeURIComponent(u)}`,
    interpret: (status, body, finalUrl) => interpretStrictProfile(status, body, finalUrl, /og:title|Threads/i),
  },
  {
    id: 'wikipedia',
    name: 'Wikipedia',
    url: (u) => `https://en.wikipedia.org/wiki/User:${encodeURIComponent(u)}`,
    interpret: (status, body) => {
      if (status === 404) return { exists: false, evidence: 'HTTP 404' }
      if (/Wikipedia does not have a|no user by this name/i.test(body)) return { exists: false, evidence: 'Wikipedia missing user' }
      if (status === 200 && /User:|mw-userpage/i.test(body)) return { exists: true, evidence: 'Wikipedia user page' }
      if (status === 200) return { exists: null, evidence: 'Wikipedia 200 without user marker' }
      return { exists: null, evidence: `HTTP ${status}` }
    },
  },
  {
    id: 'letterboxd',
    name: 'Letterboxd',
    url: (u) => `https://letterboxd.com/${encodeURIComponent(u)}/`,
    interpret: (status, body, finalUrl) => interpretStrictProfile(status, body, finalUrl, /letterboxd|og:title|films/i),
  },
  {
    id: 'myanimelist',
    name: 'MyAnimeList',
    url: (u) => `https://myanimelist.net/profile/${encodeURIComponent(u)}`,
    interpret: (status, body, finalUrl) => interpretStrictProfile(status, body, finalUrl, /myanimelist|og:title/i),
  },
  {
    id: 'anilist',
    name: 'AniList',
    url: (u) => `https://anilist.co/user/${encodeURIComponent(u)}/`,
    interpret: (status, body, finalUrl) => interpretStrictProfile(status, body, finalUrl, /anilist|og:title/i),
  },
  {
    id: 'lichess',
    name: 'Lichess',
    url: (u) => `https://lichess.org/api/user/${encodeURIComponent(u)}`,
    profileUrl: (u) => `https://lichess.org/@/${encodeURIComponent(u)}`,
    interpret: (status, body) => interpretApiOr404(status, body, /"id"|username|perfs/),
  },
  {
    id: 'chess',
    name: 'Chess.com',
    url: (u) => `https://api.chess.com/pub/player/${encodeURIComponent(u)}`,
    profileUrl: (u) => `https://www.chess.com/member/${encodeURIComponent(u)}`,
    interpret: (status, body) => interpretApiOr404(status, body, /username|player_id|url/),
  },
  {
    id: 'steam',
    name: 'Steam',
    url: (u) => `https://steamcommunity.com/id/${encodeURIComponent(u)}`,
    interpret: (status, body) => {
      if (status === 404) return { exists: false, evidence: 'HTTP 404' }
      if (/The specified profile could not be found/i.test(body)) return { exists: false, evidence: 'Steam missing profile' }
      if (status === 200 && /og:type|profile_header|steamcommunity/i.test(body) && !/could not be found/i.test(body)) {
        return { exists: true, evidence: 'Steam profile page' }
      }
      if (status === 200) return { exists: null, evidence: 'Steam 200 without profile marker' }
      return { exists: null, evidence: `HTTP ${status}` }
    },
  },
  {
    id: 'roblox',
    name: 'Roblox',
    url: () => 'https://users.roblox.com/v1/usernames/users',
    profileUrl: (u) => `https://www.roblox.com/users/profile?username=${encodeURIComponent(u)}`,
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: (u) => JSON.stringify({ usernames: [u], excludeBannedUsers: false }),
    interpret: (status, body) => {
      if (status !== 200) return { exists: null, evidence: `HTTP ${status}` }
      try {
        const parsed = JSON.parse(body) as { data?: Array<{ name?: string; id?: number }> }
        if (Array.isArray(parsed.data) && parsed.data.length > 0) {
          return { exists: true, evidence: `Roblox user ${parsed.data[0]?.name}`, extra: parsed.data[0]?.name }
        }
        return { exists: false, evidence: 'Roblox usernames API empty' }
      } catch {
        return { exists: null, evidence: 'Roblox JSON unreadable' }
      }
    },
  },
  {
    id: 'namemc',
    name: 'NameMC',
    url: (u) => `https://namemc.com/profile/${encodeURIComponent(u)}`,
    interpret: (status, body) => {
      if (status === 404) return { exists: false, evidence: 'HTTP 404' }
      if (/We couldn't find/i.test(body)) return { exists: false, evidence: 'NameMC missing profile' }
      if (status === 200 && /Minecraft Profile|og:title/i.test(body)) return { exists: true, evidence: 'NameMC profile' }
      if (status === 200) return { exists: null, evidence: 'NameMC 200 without profile marker' }
      return { exists: null, evidence: `HTTP ${status}` }
    },
  },
  {
    id: 'kaggle',
    name: 'Kaggle',
    url: (u) => `https://www.kaggle.com/${encodeURIComponent(u)}`,
    interpret: (status, body, finalUrl) => interpretStrictProfile(status, body, finalUrl, /og:title|Kaggle/i),
  },
  {
    id: 'observable',
    name: 'Observable',
    url: (u) => `https://observablehq.com/@${encodeURIComponent(u)}`,
    interpret: (status, body, finalUrl) => interpretStrictProfile(status, body, finalUrl, /observable|og:title/i),
  },
]
