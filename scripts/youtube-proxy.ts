// Dev-only reverse proxy that lets Safari show the whole YouTube site.
//
// youtube.com answers every page with `X-Frame-Options: SAMEORIGIN`, so the
// iframe in Safari stays blank. This serves the real site from its own local
// origin with the framing headers removed. Everything the page asks for goes
// back through here, so it works as a site and not as a screenshot.
//
// Watching a video is the exception. The player's streams only answer
// youtube.com, so /watch, /shorts and /live render YouTube's own embed player
// in a full-size frame instead, and a click on any link in the site is made a
// real navigation so those pages come through here rather than YouTube's
// in-page router.
//
// This is a development convenience for the web build. It listens on loopback
// only and only ever talks to youtube.com.

const UPSTREAM = 'https://www.youtube.com'
const HOSTS = /https?:\/\/(?:www\.|m\.)?youtube\.com/g
const ESCAPED_HOSTS = /https?:\\\/\\\/(?:www\.|m\.)?youtube\.com/g
const DROP_REQUEST = /^(host|origin|referer|accept-encoding|connection|content-length|sec-fetch-.*|sec-ch-.*)$/i
const DROP_RESPONSE =
  /^(x-frame-options|content-security-policy.*|content-encoding|content-length|transfer-encoding|strict-transport-security|report-to|nel|cross-origin-.*|permissions-policy|set-cookie|alt-svc)$/i
const REWRITE =
  /^(text\/html|text\/css|application\/json|application\/x-javascript|(application|text)\/javascript|text\/plain)/i

const VIDEO = /^\/(?:watch|shorts\/([\w-]{11})|live\/([\w-]{11}))/

// A link click inside the site is a full page load, so the server renders it.
const NAVIGATE = `<script>addEventListener('click',function(e){
if(e.defaultPrevented||e.button||e.metaKey||e.ctrlKey||e.shiftKey||e.altKey)return;
var a=e.target&&e.target.closest&&e.target.closest('a[href]');
if(!a||(a.target&&a.target!=='_self'))return;
var u;try{u=new URL(a.href,location.href)}catch(_){return}
if(u.origin!==location.origin||u.pathname===location.pathname&&u.search===location.search&&u.hash)return;
e.preventDefault();e.stopImmediatePropagation();location.assign(u.href)},true)</script>`

const player = (id: string, origin: string, search: URLSearchParams) => {
  const q = new URLSearchParams({ playsinline: '1', rel: '0', origin })
  const t = search.get('t') ?? search.get('start')
  const m = t?.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s?)?$/)
  const start = m ? Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0) : 0
  if (start) q.set('start', String(start))
  const list = search.get('list')
  if (list) q.set('list', list)
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>YouTube</title>
<style>html,body{margin:0;height:100%;background:#000}iframe{border:0;width:100%;height:100%;display:block}
a{position:fixed;top:12px;left:12px;z-index:2;padding:7px 14px;border-radius:999px;background:rgba(0,0,0,.55);color:#fff;
font:600 14px system-ui,sans-serif;text-decoration:none;backdrop-filter:blur(12px)}</style>
<a href="/" onclick="if(history.length>1){history.back();return false}">‹ YouTube</a>
<iframe src="https://www.youtube.com/embed/${id}?${q}" allow="autoplay; encrypted-media; picture-in-picture; fullscreen; clipboard-write" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe>`
}

const cookie = (line: string) =>
  line
    .replace(/;\s*Domain=[^;]*/i, '')
    .replace(/;\s*Secure/i, '')
    .replace(/;\s*Partitioned/i, '')
    .replace(/;\s*SameSite=none/i, '; SameSite=Lax')

export function startYoutubeProxy(port = 3002) {
  try {
    Bun.serve({
      port,
      hostname: '127.0.0.1',
      async fetch(req) {
        const url = new URL(req.url)
        // Reached as localhost or any *.localhost name, whichever the shell used.
        const origin = `${url.protocol}//${req.headers.get('host') ?? url.host}`
        const video = url.pathname.match(VIDEO)
        const id = url.pathname === '/watch' ? url.searchParams.get('v') : (video?.[1] ?? video?.[2])
        if (id && /^[\w-]{11}$/.test(id))
          return new Response(player(id, origin, url.searchParams), {
            headers: { 'content-type': 'text/html;charset=utf-8' }
          })

        const headers = new Headers()
        for (const [k, v] of req.headers) if (!DROP_REQUEST.test(k)) headers.set(k, v)
        headers.set('accept-encoding', 'identity')
        headers.set('referer', `${UPSTREAM}/`)
        if (req.headers.has('origin') || req.method !== 'GET') headers.set('origin', UPSTREAM)
        headers.set('cookie', req.headers.get('cookie') ?? '')

        let up: Response
        try {
          up = await fetch(UPSTREAM + url.pathname + url.search, {
            method: req.method,
            headers,
            body: req.method === 'GET' || req.method === 'HEAD' ? undefined : await req.arrayBuffer(),
            redirect: 'manual'
          })
        } catch (e) {
          return new Response(`YouTube is unreachable: ${e instanceof Error ? e.message : e}`, { status: 502 })
        }

        const out = new Headers()
        for (const [k, v] of up.headers) if (!DROP_RESPONSE.test(k)) out.set(k, v)
        for (const c of up.headers.getSetCookie()) out.append('set-cookie', cookie(c))
        const to = out.get('location')
        if (to) out.set('location', to.replace(HOSTS, origin))
        const type = up.headers.get('content-type') ?? ''
        if (up.status >= 300 && up.status < 400) return new Response(null, { status: up.status, headers: out })
        if (!REWRITE.test(type)) return new Response(up.body, { status: up.status, headers: out })

        let text = (await up.text()).replace(HOSTS, origin).replace(ESCAPED_HOSTS, origin.replace(/\//g, '\\/'))
        if (/^text\/html/i.test(type)) text = text.replace(/<head[^>]*>/i, (m) => m + NAVIGATE)
        return new Response(text, { status: up.status, headers: out })
      }
    })
    console.log(`YouTube proxy http://localhost:${port}/`)
  } catch (e) {
    console.warn(
      `YouTube proxy not started on :${port} (${e instanceof Error ? e.message : e}); Safari falls back to the video player only.`
    )
  }
}
