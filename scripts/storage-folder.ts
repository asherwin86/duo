// The Duo's storage folder, on disk, served by the dev server.
//
// A web page cannot open a folder on the computer in every browser (Firefox has no
// way to), so the dev server owns one and the phone's Downloads is that folder:
// a file put into `storage/Downloads` shows up in Files, and a download from Safari
// lands there with no save window. A built site has no server, so none of this
// exists there and the phone keeps Downloads in the browser, as before.
//
// Only requests the page itself makes are served: the Host must be this machine, and
// the writes are methods a web page on another site cannot send without a preflight
// this server never answers.

import { existsSync, mkdirSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fromThisMachine } from './local-only.ts'

const ROOT = resolve(process.env.DUO_STORAGE ?? './storage')
const DOWNLOADS = join(ROOT, 'Downloads')
/**
 * What a folder can safely hold under any name a person drops in: no path pieces, nothing the computer reserves,
 * nothing hidden. Looser than the phone's own file store (sdk/guards.ts), because these names come from the computer.
 */
// biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are exactly what a name must not hold
const NAME = /^[^./\\:*?"<>|\x00-\x1f][^/\\:*?"<>|\x00-\x1f]*[^./\\:*?"<>|\x00-\x1f ]$|^[^./\\:*?"<>|\x00-\x1f]$/
/** Names Windows keeps for devices, with or without an extension: a file called `NUL` or `con.apk` cannot be opened or deleted from Explorer. */
const DEVICE = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i
const MAX_NAME = 128
const MAX_BYTES = 512 * 1024 * 1024

export const storageFolder = DOWNLOADS

mkdirSync(DOWNLOADS, { recursive: true })
const readme = join(ROOT, 'README.txt')
if (!existsSync(readme))
  writeFileSync(
    readme,
    [
      'Duo storage',
      '',
      "Downloads/  The phone's Files > On My iPhone > Downloads. Put an APK, IPA or any file here and it shows up",
      '            on the phone; what Safari downloads is saved here. Names may use letters, digits, spaces and',
      '            . _ - ( ) + @ [ ] and more; a name that starts with a dot, ends in a dot or a space, holds',
      '            / \\ : * ? " < > |, or is a Windows device name such as CON, NUL or COM1 is not shown.',
      '',
      'Settings > General > Duo Storage on the phone turns "Save Downloads Automatically" on or off.',
      ''
    ].join('\n')
  )

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const fail = (status: number, error: string) => json({ error }, status)

export const validName = (value: unknown): value is string =>
  typeof value === 'string' &&
  new TextEncoder().encode(value).length <= MAX_NAME &&
  NAME.test(value) &&
  !DEVICE.test(value)

const row = (name: string) => {
  const path = join(DOWNLOADS, name)
  const stat = statSync(path)
  return {
    name,
    size: stat.size,
    type: Bun.file(path).type.split(';')[0] || 'application/octet-stream',
    at: Math.round(stat.mtimeMs)
  }
}

/** Writes through a temporary name so a half-written file is never listed. */
async function write(name: string, body: ReadableStream<Uint8Array> | null, expected: number) {
  if (!body) throw new Error('No file was sent')
  if (expected > MAX_BYTES) throw new Error(`That file is past ${MAX_BYTES / 1024 / 1024} MB`)
  const temp = join(DOWNLOADS, `.part-${crypto.randomUUID()}`)
  const sink = Bun.file(temp).writer()
  let got = 0
  try {
    const reader = body.getReader()
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      got += value.byteLength
      if (got > MAX_BYTES) throw new Error(`That file is past ${MAX_BYTES / 1024 / 1024} MB`)
      sink.write(value)
    }
    await sink.end()
    renameSync(temp, join(DOWNLOADS, name))
  } catch (e) {
    await sink.end().catch(() => {})
    try {
      unlinkSync(temp)
    } catch {
      /* Nothing was created. */
    }
    throw e
  }
  return row(name)
}

/**
 * The storage API, or `undefined` for a request that is not for it. `peer` is the address of the other end of the
 * connection: only this machine's own page may use it (see local-only.ts).
 */
export async function storage(req: Request, peer?: string | null): Promise<Response | undefined> {
  const url = new URL(req.url)
  if (!url.pathname.startsWith('/__storage/')) return undefined
  if (!fromThisMachine(req, peer)) return fail(403, 'The storage folder is only served to this machine')
  const route = url.pathname.slice('/__storage/'.length)

  if (route === 'info' && req.method === 'GET') return json({ path: DOWNLOADS })

  if (route === 'downloads' && req.method === 'GET') {
    const names = readdirSync(DOWNLOADS, { withFileTypes: true })
      .filter((e) => e.isFile() && validName(e.name))
      .map((e) => e.name)
    return json(names.map(row).sort((a, b) => b.at - a.at))
  }

  if (route === 'fetch' && req.method === 'POST') {
    // JSON is a content type a page on another site cannot send without asking first, so this is the page's own.
    if (!/^application\/json\b/i.test(req.headers.get('content-type') ?? '')) return fail(415, 'JSON is needed')
    const body = (await req.json().catch(() => null)) as { url?: unknown; name?: unknown } | null
    if (!body || !validName(body.name) || typeof body.url !== 'string')
      return fail(400, 'A name and an address are needed')
    let target: URL
    try {
      target = new URL(body.url)
    } catch {
      return fail(400, 'That is not an address')
    }
    if (target.protocol !== 'http:' && target.protocol !== 'https:') return fail(400, 'Only http and https addresses')
    let response: Response
    try {
      response = await fetch(target, { redirect: 'follow', headers: { 'user-agent': 'Mozilla/5.0 (Duo storage)' } })
    } catch {
      return fail(502, 'The site could not be reached')
    }
    if (!response.ok) return fail(502, `The site answered ${response.status}`)
    try {
      return json(await write(body.name, response.body, Number(response.headers.get('content-length')) || 0))
    } catch (e) {
      return fail(413, e instanceof Error ? e.message : 'The file could not be saved')
    }
  }

  let file: string | null = null
  try {
    if (route.startsWith('downloads/')) file = decodeURIComponent(route.slice('downloads/'.length))
  } catch {
    /* A malformed escape is not a name; it is refused below like any other. */
  }
  if (file === null || !validName(file)) return fail(400, 'That is not a file name this phone can hold')
  const path = join(DOWNLOADS, file)

  if (req.method === 'GET')
    return existsSync(path) && statSync(path).isFile() ? new Response(Bun.file(path)) : fail(404, 'No such file')
  if (req.method === 'PUT') {
    try {
      return json(await write(file, req.body, Number(req.headers.get('content-length')) || 0))
    } catch (e) {
      return fail(413, e instanceof Error ? e.message : 'The file could not be saved')
    }
  }
  if (req.method === 'DELETE') {
    try {
      unlinkSync(path)
    } catch {
      /* Already gone is the same as deleted. */
    }
    return new Response(null, { status: 204 })
  }
  return fail(405, 'Not supported')
}
