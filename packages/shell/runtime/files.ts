// The durable blob store behind `os.files` and the baked `os.files` prop.
// `appdata` settles the strings-only contract (contract.md §4.2); audio,
// renders and friends get their own store rather than a base64 workaround.
// Quota is recomputed from the rows themselves on every put, so a crashed
// delete never leaks bytes a retry would have to pay for twice.

import { fileNameValid, PlatformError } from '../../sdk/guards.ts'
import type { DownloadsHost, FileHost } from '../../sdk/legacy.ts'
import { LIMITS, type StoredFile } from '../../sdk/protocol.ts'
import { entries, put, read, result, transaction } from './database.ts'

type Row = { blob: Blob; type: string; size: number; at: number }
const row = (name: string, r: Row): StoredFile => ({ name, size: r.size, type: r.type, at: r.at })

type Limits = { file: number; files: number; filesBytes: number }
/** What an app may keep in its own namespace: the platform contract's limits, unchanged. */
const APP_LIMITS: Limits = LIMITS
/**
 * The phone's Downloads. Real packages are far past an app's 32 MiB blob, so this namespace
 * has room of its own; it is the browser's storage, which refuses what it cannot hold.
 */
export const DOWNLOAD_LIMITS: Limits = { file: 512 * 1024 * 1024, files: 64, filesBytes: 1024 * 1024 * 1024 }
export async function fileService(
  ns: string,
  method: string,
  p: Record<string, unknown>,
  limits: Limits = APP_LIMITS
): Promise<unknown> {
  switch (method) {
    case 'file.list':
      return transaction(['appfiles'], 'readonly', async (tx) =>
        (await entries<Row>(tx, 'appfiles', ns)).map(([name, r]) => row(name, r))
      )
    case 'file.get': {
      if (!fileNameValid(p.name)) throw new PlatformError('E_ARGS')
      const got = await transaction(['appfiles'], 'readonly', (tx) => read<Row>(tx, 'appfiles', [ns, p.name as string]))
      return got?.blob ?? null
    }
    case 'file.put': {
      const blob = p.blob
      if (!fileNameValid(p.name) || !(blob instanceof Blob) || blob.size > limits.file)
        throw new PlatformError('E_ARGS')
      return transaction(['appfiles'], 'readwrite', async (tx) => {
        const existing = await entries<Row>(tx, 'appfiles', ns)
        const replacing = existing.find(([name]) => name === p.name)?.[1]
        const used = existing.reduce((n, [, r]) => n + r.size, 0) - (replacing?.size ?? 0)
        if (!replacing && existing.length >= limits.files) throw new PlatformError('E_QUOTA', 'Too many files')
        if (used + blob.size > limits.filesBytes) throw new PlatformError('E_QUOTA', 'File storage is full')
        const next: Row = { blob, type: blob.type, size: blob.size, at: Date.now() }
        await put(tx, 'appfiles', [ns, p.name as string], next)
        return row(p.name as string, next)
      })
    }
    case 'file.del': {
      if (!fileNameValid(p.name)) throw new PlatformError('E_ARGS')
      return transaction(['appfiles'], 'readwrite', (tx) =>
        result(tx.objectStore('appfiles').delete([ns, p.name as string])).then(() => undefined)
      )
    }
  }
  throw new PlatformError('E_ARGS')
}

/** The baked app's `os.files`: the same service bound to its own namespace. */
export const fileHost = (ns: string): FileHost => ({
  list: () => fileService(ns, 'file.list', {}) as Promise<StoredFile[]>,
  get: (name: string) => fileService(ns, 'file.get', { name }) as Promise<Blob | null>,
  put: (name: string, blob: Blob) => fileService(ns, 'file.put', { name, blob }) as Promise<StoredFile>,
  del: (name: string) => fileService(ns, 'file.del', { name }) as Promise<void>
})

const AUTO_KEY = 'os.downloads.auto'
const autoSubs = new Set<() => void>()
/** Whether a folder-backed download skips the browser's save window; on until the person turns it off. */
const readAuto = () => {
  try {
    return localStorage.getItem(AUTO_KEY) !== 'off'
  } catch {
    return true
  }
}
let folder: Promise<string | null> | undefined
/** The dev server's storage folder, asked once. A built site answers the probe with a page or nothing, never JSON. */
const probe = () =>
  (folder ??= fetch('/__storage/info', { cache: 'no-store' })
    .then(async (r) =>
      r.ok && r.headers.get('content-type')?.includes('json') ? ((await r.json()).path as string) : null
    )
    .catch(() => null))
const asFile = (x: unknown): StoredFile => x as StoredFile
async function reply(r: Response): Promise<unknown> {
  if (r.ok) return r.status === 204 ? undefined : r.json()
  const detail = await r.json().catch(() => null)
  throw new PlatformError(
    r.status === 413 ? 'E_QUOTA' : 'E_ARGS',
    detail?.error ?? `The storage folder answered ${r.status}`
  )
}
const path = (name: string) => `/__storage/downloads/${encodeURIComponent(name)}`
const here = (method: string, p: Record<string, unknown>) => fileService('shared:downloads', method, p, DOWNLOAD_LIMITS)

/**
 * Safari writes here and Files reads: the one namespace every baked app shares. With the dev server it is the
 * storage folder on disk; without, the browser's own store.
 */
export const downloadsHost: DownloadsHost = {
  folder: probe,
  auto: readAuto,
  setAuto(on) {
    try {
      localStorage.setItem(AUTO_KEY, on ? 'on' : 'off')
    } catch {
      /* The choice lasts until reload. */
    }
    for (const fn of autoSubs) fn()
  },
  subscribe(fn) {
    autoSubs.add(fn)
    return () => {
      autoSubs.delete(fn)
    }
  },
  async list() {
    if (!(await probe())) return (await here('file.list', {})) as StoredFile[]
    return (await reply(await fetch('/__storage/downloads', { cache: 'no-store' }))) as StoredFile[]
  },
  async get(name) {
    if (!(await probe())) return (await here('file.get', { name })) as Blob | null
    const r = await fetch(path(name))
    return r.ok ? r.blob() : null
  },
  async put(name, blob) {
    if (!(await probe())) return (await here('file.put', { name, blob })) as StoredFile
    return asFile(await reply(await fetch(path(name), { method: 'PUT', body: blob })))
  },
  async del(name) {
    if (!(await probe())) return void (await here('file.del', { name }))
    await reply(await fetch(path(name), { method: 'DELETE' }))
  },
  async fetchInto(url, name) {
    if (!(await probe())) throw new PlatformError('E_ARGS', 'There is no storage folder to fetch into')
    return asFile(
      await reply(
        await fetch('/__storage/fetch', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ url, name })
        })
      )
    )
  }
}
