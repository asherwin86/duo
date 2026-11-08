// YouTube's watch pages refuse to be framed, but its embed player does not. The
// tab keeps the URL the person typed (address bar, history and bookmarks all
// show it); only the frame's src swaps to the player for that same video.

const ID = /^[\w-]{11}$/

const seconds = (t: string | null) => {
  const m = t?.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s?)?$/)
  return m ? Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0) : 0
}

export function embed(url: string): string {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return url
  }
  const h = u.hostname.replace(/^(www|m|music)\./, '')
  let id: string | null = null
  if (h === 'youtu.be') id = u.pathname.slice(1)
  else if (h === 'youtube.com' || h === 'youtube-nocookie.com') {
    const [, kind, rest] = u.pathname.split('/')
    if (u.pathname === '/watch') id = u.searchParams.get('v')
    else if (kind === 'shorts' || kind === 'live' || kind === 'embed' || kind === 'v') id = rest ?? null
  }
  if (!id || !ID.test(id)) return url
  const q = new URLSearchParams({ playsinline: '1', rel: '0' })
  // The player checks the embedding page's origin; without it, error 153.
  const here = typeof location === 'undefined' ? '' : location.origin
  if (/^https?:/.test(here)) q.set('origin', here)
  const start = seconds(u.searchParams.get('t') ?? u.searchParams.get('start'))
  if (start) q.set('start', String(start))
  const list = u.searchParams.get('list')
  if (list) q.set('list', list)
  return `https://www.youtube.com/embed/${id}?${q}`
}

// The rest of youtube.com (home, search, channels) refuses framing outright. The
// dev server runs a local proxy that serves it frameable on this port; with no
// proxy, those pages stay blank as any site that refuses framing does.
const PROXY_PORT = 3002
const local = (h: string) => h === 'localhost' || h === '127.0.0.1' || h.endsWith('.localhost')

// What the frame loads for a tab's URL: the embed player for a video, the
// local proxy for the rest of YouTube, else the page itself.
export function frame(url: string): string {
  const player = embed(url)
  if (player !== url) return player
  try {
    const u = new URL(url)
    if (!/^(www\.|m\.)?youtube\.com$/.test(u.hostname) || typeof location === 'undefined' || !local(location.hostname))
      return url
    return `http://${location.hostname}:${PROXY_PORT}${u.pathname}${u.search}${u.hash}`
  } catch {
    return url
  }
}

// The embed player refuses to start with no Referer (error 153), so its frame
// sends one; every other page keeps sending none.
export const referrer = (url: string) =>
  embed(url) === url ? ('no-referrer' as const) : ('strict-origin-when-cross-origin' as const)

export const ALLOW = 'autoplay; encrypted-media; picture-in-picture; fullscreen; clipboard-write'
