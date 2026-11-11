// Dev server. Bun's plain HTML entry server answers every unknown path with
// the page itself, which turns the USD model into HTML; this serves public/
// as real files, the way `bun build` and Tauri ship it.
import index from './packages/shell/index.html'
import { allowed, android, screen, wantsScreen } from './scripts/android-emulator.ts'
import { buildPreinstalled } from './scripts/build-preinstalled.ts'
import { storage, storageFolder } from './scripts/storage-folder.ts'
import { startYoutubeProxy } from './scripts/youtube-proxy.ts'

await buildPreinstalled()

const port = Number(process.env.PORT ?? 3000)
Bun.serve({
  port,
  routes: { '/': index },
  development: { hmr: true, console: true },
  websocket: screen,
  async fetch(req, server) {
    // The address of the other end of the connection: a Host header is written by the sender, this is not.
    const peer = server.requestIP(req)?.address
    // The emulator's screen is a WebSocket; only this machine's own page may open one.
    if (wantsScreen(req))
      return allowed(req, peer) && server.upgrade(req) ? undefined : new Response('Not allowed', { status: 403 })
    const stored = await storage(req, peer)
    if (stored) return stored
    const emulated = await android(req, peer)
    if (emulated) return emulated
    let path: string
    try {
      path = decodeURIComponent(new URL(req.url).pathname)
    } catch {
      return new Response('Not a valid address', { status: 400 })
    }
    const file = Bun.file(
      `${path.startsWith('/cdn/') || path.startsWith('/preinstalled/') ? './dist' : './public'}${path}`
    )
    if (!path.includes('..') && (await file.exists())) return new Response(file)
    return new Response('Not found', { status: 404 })
  }
})
startYoutubeProxy()
console.log(`http://localhost:${port}/`)
console.log(`Duo storage folder: ${storageFolder}`)
// Bun bundles the page on its first request, which is seconds of blank page for
// whoever loads it first. Ask for it once now so that is no one's browser.
void fetch(`http://localhost:${port}/`).catch(() => {})
