// Dev server. Bun's plain HTML entry server answers every unknown path with
// the page itself, which turns the USD model into HTML; this serves public/
// as real files, the way `bun build` and Tauri ship it.
import index from './packages/shell/index.html'
import { buildPreinstalled } from './scripts/build-preinstalled.ts'
import { storage, storageFolder } from './scripts/storage-folder.ts'
import { startYoutubeProxy } from './scripts/youtube-proxy.ts'

await buildPreinstalled()

const port = Number(process.env.PORT ?? 3000)
Bun.serve({
  port,
  routes: { '/': index },
  development: { hmr: true, console: true },
  async fetch(req) {
    const stored = await storage(req)
    if (stored) return stored
    const path = decodeURIComponent(new URL(req.url).pathname)
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
