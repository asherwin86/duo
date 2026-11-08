// Package files Safari keeps rather than shows: an address that ends in one of
// these is fetched, saved to the phone's Downloads and handed to the computer.

const PACKAGE = /\.(apk|apks|xapk|aab|ipa|ipk)$/i
/** Safari's own ceiling; the phone's Downloads (shell/runtime/files.ts) is the same size. */
export const MAX_BYTES = 512 * 1024 * 1024

export const isPackage = (url: string) => {
  try {
    return PACKAGE.test(new URL(url).pathname)
  } catch {
    return false
  }
}

/** A name the file store accepts: starts alphanumeric, no odd characters, 128 bytes at most. */
export function downloadName(url: string) {
  let last = ''
  try {
    last = decodeURIComponent(new URL(url).pathname.split('/').pop() ?? '')
  } catch {
    /* A malformed escape falls through to the default name. */
  }
  let name = last
    .replace(/[^\w.() -]/g, '_')
    .replace(/^[^a-zA-Z0-9]+/, '')
    .trim()
  if (!name) name = 'download'
  if (name.length > 120) {
    const dot = name.lastIndexOf('.')
    const ext = dot > 0 ? name.slice(dot).slice(0, 8) : ''
    name = name.slice(0, 120 - ext.length) + ext
  }
  return name
}

export const megabytes = (bytes: number) =>
  bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`

/** The server answered, but not with the file: unlike a blocked request, trying again elsewhere will not help. */
export class ServerError extends Error {}

/** The whole file, with progress. Rejects with a TypeError when the site does not allow this page to read it. */
export async function fetchFile(url: string, onProgress: (got: number, total: number) => void, signal: AbortSignal) {
  const response = await fetch(url, { credentials: 'omit', referrerPolicy: 'no-referrer', signal })
  if (!response.ok) throw new ServerError(`The site answered ${response.status}`)
  const total = Number(response.headers.get('content-length')) || 0
  if (total > MAX_BYTES)
    throw new ServerError(`That file is ${megabytes(total)}; the phone keeps up to ${megabytes(MAX_BYTES)}`)
  const type = response.headers.get('content-type') || 'application/octet-stream'
  if (!response.body) return response.blob()
  const reader = response.body.getReader()
  const chunks: Uint8Array<ArrayBuffer>[] = []
  let got = 0
  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    got += value.byteLength
    if (got > MAX_BYTES) {
      void reader.cancel()
      throw new ServerError(`That file is past ${megabytes(MAX_BYTES)}`)
    }
    chunks.push(value as Uint8Array<ArrayBuffer>)
    onProgress(got, total)
  }
  return new Blob(chunks, { type })
}

/** The browser's own download of a blob we hold: it lands in the computer's Downloads folder. */
export function saveToComputer(blob: Blob, name: string) {
  const href = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = href
  a.download = name
  a.hidden = true
  document.body.append(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(href), 60_000)
}

/**
 * For a site that will not let the phone read its file: a hidden frame, so a file that
 * the server marks as a download goes to the computer without this page navigating away.
 */
export function sendToComputer(url: string) {
  const frame = document.createElement('iframe')
  frame.hidden = true
  frame.referrerPolicy = 'no-referrer'
  frame.src = url
  document.body.append(frame)
  setTimeout(() => frame.remove(), 60_000)
}
