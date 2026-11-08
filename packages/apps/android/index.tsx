// Android: the real Android Emulator the dev server runs (scripts/android-emulator.ts), shown as a screen on the
// phone. Apps come from the phone's Downloads: Files opens an APK here, or pick one from the list. Without the dev
// server or the Android SDK there is no emulator to show, and the page says what is missing instead of pretending.

import type { Os, StoredFile } from '@doan-labs/duo-sdk'
import { Button, Screen, Text } from '@doan-labs/duo-uikit'
import { Sym } from '@doan-labs/duo-uikit/sym.tsx'
import * as stylex from '@stylexjs/stylex'
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import {
  canDecode,
  current,
  hasChecked,
  keepFresh,
  pressKey,
  run,
  send,
  show,
  start,
  stop,
  typeText,
  watch
} from './emulator.ts'
import { styles } from './styles.ts'

/** The keys that move around or edit in a form, as Android's key codes. */
const KEYS: Record<string, number> = {
  Enter: 66,
  Backspace: 67,
  Delete: 112,
  Tab: 61,
  ArrowUp: 19,
  ArrowDown: 20,
  ArrowLeft: 21,
  ArrowRight: 22
}

/** Android's three-button navigation: Back, Home, Recents. */
const NAV = [
  { code: 4, label: 'Back', glyph: '◁' },
  { code: 3, label: 'Home', glyph: '○' },
  { code: 187, label: 'Recents', glyph: '□' }
] as const

export const Android = ({ os }: { os: Os }) => {
  const status = useSyncExternalStore(watch, current)
  const checked = useSyncExternalStore(watch, hasChecked)
  const [apks, setApks] = useState<StoredFile[]>([])
  const [picking, setPicking] = useState(false)
  const [note, setNote] = useState('')
  const canvas = useRef<HTMLCanvasElement>(null)
  const press = useRef<{ x: number; y: number; px: number; py: number; at: number } | null>(null)
  const ran = useRef<string | undefined>(undefined)
  const running = status.state === 'running'

  // The live display asks the dev server how Android is doing; the copy on the other display reads the same answer.
  useEffect(() => (os.mirror ? undefined : keepFresh()), [os.mirror])
  useEffect(() => (running && canvas.current ? show(canvas.current) : undefined), [running])

  const install = (name: string) => {
    setNote(`Installing ${name}…`)
    setPicking(false)
    run(name)
      .then((r) => setNote(r.opened ? `Opened ${r.package}` : 'Installed. Open it from the Android home screen.'))
      .catch((e) => setNote(e instanceof Error ? e.message : 'That did not work'))
  }

  // An APK handed over by Files starts Android if it is off, and installs once it is up.
  const arg = os.arg
  // biome-ignore lint/correctness/useExhaustiveDependencies: `install` only sets state and calls the server; this runs when the APK or the emulator's state changes, once per APK
  useEffect(() => {
    if (os.mirror || !arg || !arg.toLowerCase().endsWith('.apk') || !checked) return
    if (status.state === 'off' && status.reachable && status.sdk && ran.current !== `${arg}:start`) {
      ran.current = `${arg}:start`
      void start().catch((e) => setNote(e instanceof Error ? e.message : 'Android could not start'))
    }
    if (running && ran.current !== arg) {
      ran.current = arg
      install(arg)
    }
  }, [arg, checked, status.state, status.reachable, status.sdk, running, os.mirror])

  // The APKs in Downloads, newest first, while the list is open.
  useEffect(() => {
    if (!picking || !os.downloads) return
    let alive = true
    const load = () =>
      void os.downloads?.list().then((all) => {
        if (alive) setApks(all.filter((f) => /\.apk$/i.test(f.name)).sort((a, b) => b.at - a.at))
      })
    load()
    const id = setInterval(load, 3000)
    return () => {
      alive = false
      clearInterval(id)
    }
  }, [picking, os.downloads])

  // Where a touch fell on Android's own screen, 0 to 1 each way. The picture sits letterboxed in the canvas, so the
  // box around it is measured away first.
  const at = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const box = e.currentTarget.getBoundingClientRect()
    const { width, height } = e.currentTarget
    const scale = Math.min(box.width / width, box.height / height)
    const w = width * scale
    const h = height * scale
    const clamp = (n: number) => Math.min(1, Math.max(0, n))
    return {
      x: clamp((e.clientX - box.left - (box.width - w) / 2) / w),
      y: clamp((e.clientY - box.top - (box.height - h) / 2) / h)
    }
  }
  const release = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const p = press.current
    press.current = null
    if (!p || os.mirror) return
    const to = at(e)
    const ms = performance.now() - p.at
    if (Math.hypot(e.clientX - p.px, e.clientY - p.py) < 8) {
      // A long press is a swipe that goes nowhere for as long as the finger stayed.
      if (ms > 450) send({ t: 'swipe', x1: to.x, y1: to.y, x2: to.x, y2: to.y, ms })
      else send({ t: 'tap', ...to })
    } else send({ t: 'swipe', x1: p.x, y1: p.y, x2: to.x, y2: to.y, ms: Math.max(60, ms) })
  }

  let body: React.ReactNode
  if (!checked) body = <Text>Looking for Android…</Text>
  else if (!status.reachable)
    body = (
      <>
        <Text xstyle={styles.title}>Android needs the dev server</Text>
        <Text xstyle={styles.line}>
          The emulator runs on the computer, started by bun run dev. A built site has no emulator to show.
        </Text>
      </>
    )
  else if (!status.sdk)
    body = (
      <>
        <Text xstyle={styles.title}>Android is not installed</Text>
        <Text xstyle={styles.line}>
          Install the Android SDK with its emulator and an Android 14 system image on the computer running the dev
          server, then reload. README.md has the steps.
        </Text>
      </>
    )
  else if (!canDecode())
    body = (
      <>
        <Text xstyle={styles.title}>This browser cannot show Android</Text>
        <Text xstyle={styles.line}>The screen is a video stream. Use a current Chrome, Edge or Firefox.</Text>
      </>
    )
  else if (status.state === 'off')
    body = (
      <>
        <Text xstyle={styles.title}>Android</Text>
        <Text xstyle={styles.line}>A real Android 14 phone, running on this computer.</Text>
        {status.message && <Text xstyle={styles.error}>{status.message}</Text>}
        <Button
          variant="filled"
          onClick={() => void start().catch((e) => setNote(e instanceof Error ? e.message : 'Android could not start'))}
        >
          Start Android
        </Button>
      </>
    )
  else if (status.state === 'booting')
    body = (
      <>
        <Text xstyle={styles.title}>Starting Android…</Text>
        <Text xstyle={styles.line}>The first start takes a minute or two.</Text>
      </>
    )

  if (body)
    return (
      <Screen xstyle={styles.center}>
        <div {...stylex.props(styles.card)}>{body}</div>
        {note && <Text xstyle={styles.error}>{note}</Text>}
      </Screen>
    )

  return (
    <Screen xstyle={styles.page}>
      <div {...stylex.props(styles.bar)}>
        <Text xstyle={styles.barTitle}>Android</Text>
        <Button variant="plain" onClick={() => setPicking((p) => !p)}>
          Apps
        </Button>
        <Button variant="plain" onClick={() => void stop().catch(() => {})}>
          Stop
        </Button>
      </div>
      <div {...stylex.props(styles.stage)}>
        <canvas
          ref={canvas}
          {...stylex.props(styles.screen)}
          tabIndex={0}
          aria-label="Android screen"
          // The phone's own keyboard shortcuts (L is the side button, the arrows are the volume) must not hear
          // what is typed into Android.
          onKeyUp={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            e.stopPropagation()
            if (os.mirror || e.metaKey || e.ctrlKey || e.altKey) return
            const code = KEYS[e.key]
            if (code) {
              e.preventDefault()
              pressKey(code)
            } else if (e.key.length === 1) {
              e.preventDefault()
              typeText(e.key)
            }
          }}
          onPaste={(e) => {
            const text = e.clipboardData.getData('text')
            if (!text || os.mirror) return
            e.preventDefault()
            typeText(text)
          }}
          onPointerDown={(e) => {
            // Focus follows the touch, so what is typed next goes into the field just tapped.
            e.currentTarget.focus()
            e.currentTarget.setPointerCapture(e.pointerId)
            press.current = { ...at(e), px: e.clientX, py: e.clientY, at: performance.now() }
          }}
          onPointerUp={release}
          onPointerCancel={() => {
            press.current = null
          }}
        />
        {picking && (
          <div {...stylex.props(styles.list)}>
            {apks.length ? (
              apks.map((f) => (
                <button type="button" key={f.name} {...stylex.props(styles.item)} onClick={() => install(f.name)}>
                  <Sym name="down" size={16} />
                  <span {...stylex.props(styles.itemName)}>{f.name}</span>
                </button>
              ))
            ) : (
              <Text xstyle={styles.line}>
                No APKs in Downloads. Put one in the storage folder, or open an APK address in Safari.
              </Text>
            )}
          </div>
        )}
      </div>
      <div {...stylex.props(styles.nav)}>
        {NAV.map((n) => (
          <button
            type="button"
            key={n.code}
            aria-label={n.label}
            {...stylex.props(styles.navButton)}
            onClick={() => !os.mirror && send({ t: 'key', code: n.code })}
          >
            {n.glyph}
          </button>
        ))}
        <input
          {...stylex.props(styles.type)}
          placeholder="Type here, or click the screen and use your keyboard"
          onKeyDown={(e) => {
            if (e.key !== 'Enter' || os.mirror) return
            send({ t: 'text', text: e.currentTarget.value })
            e.currentTarget.value = ''
          }}
        />
      </div>
      {note && <Text xstyle={styles.note}>{note}</Text>}
    </Screen>
  )
}
