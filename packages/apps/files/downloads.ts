import type { Os } from '@doan-labs/duo-sdk'

type Saved = { name: string; size: number; type: string; at: number }

let list: Saved[] = []
const subs = new Set<() => void>()
/** The phone's Downloads as Safari left them, newest first; one list for every Files view. */
export const downloads = {
  get: () => list,
  subscribe: (fn: () => void) => {
    subs.add(fn)
    return () => {
      subs.delete(fn)
    }
  },
  async refresh(os: Os) {
    const next = ((await os.downloads?.list().catch(() => [])) ?? []).sort((a, b) => b.at - a.at)
    // The array only changes when a file does, so a poll that finds nothing new redraws nothing.
    if (JSON.stringify(next) === JSON.stringify(list)) return
    list = next
    for (const fn of subs) fn()
  }
}

export const fileKind = (name: string) =>
  /\.ipa$/i.test(name) ? 'iOS app' : /\.(apk|apks|xapk|aab)$/i.test(name) ? 'Android package' : 'Package'

export const megabytes = (bytes: number) =>
  bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`

/** The browser's own download of a file the phone holds: it lands in the computer's Downloads folder. */
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
