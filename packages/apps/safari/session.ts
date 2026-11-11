// The tabs Safari has open, shared by every copy of it on screen.
//
// Folding moves the app to the other display by mounting a second copy there, and a copy keeps whatever its
// own state holds: tabs kept in component state came back as a fresh start page. They live here instead, so
// both displays show the same tabs, the same open one and the same page zoom, while what is only about one
// screen (the tab grid, a menu, the bar sliding away) stays with that screen's copy.
//
// The session ends when the last copy is gone: closing Safari and opening it again starts over, as it always has.

export type Tab = { id: number; hist: string[]; at: number; priv: boolean }
export type Session = { tabs: Tab[]; cur: number; zooms: Record<string, number> }

let seq = 0
/** A tab with no history shows the start page: favourites and a focused address bar. */
export const tab = (url?: string, priv = false): Tab => ({ id: seq++, hist: url ? [url] : [], at: 0, priv })
export const at = (x: Tab) => x.hist[x.at]

let session: Session | null = null
let copies = 0
const subs = new Set<() => void>()

/**
 * The session, begun on `url` if no copy has one yet. Called while rendering, so it must be safe to repeat: the
 * second call, from the other display or a re-render, finds the first.
 */
export function start(url: string) {
  session ??= { tabs: [tab(url)], cur: -1, zooms: {} }
  return session
}

export const sessions = {
  subscribe: (fn: () => void) => {
    subs.add(fn)
    return () => subs.delete(fn)
  },
  // Only read by a copy that has already called `start`.
  get: () => session!,
  set(patch: Partial<Session>) {
    if (!session) return
    session = { ...session, ...patch }
    for (const fn of subs) fn()
  }
}

/**
 * A copy is on screen until the returned function runs. The end is put off a tick so a copy that is torn down
 * and put straight back (React's development double mount) does not lose the tabs.
 */
export function hold() {
  copies++
  return () => {
    copies--
    setTimeout(() => {
      if (copies === 0) session = null
    })
  }
}
