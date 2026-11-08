// The page's side of the Android emulator the dev server runs (scripts/android-emulator.ts): its status, the
// screen as an H.264 stream drawn into canvases, and taps and swipes sent back. One connection serves every
// canvas, so the cover and the inner display show the same Android; only the live display opens it.

export type State = 'off' | 'booting' | 'running'
export type Status = {
  /** The dev server answered. A built site has no emulator to ask. */
  reachable: boolean
  /** The Android SDK and its emulator are on the computer. */
  sdk: boolean
  state: State
  message: string
}

let status: Status = { reachable: false, sdk: false, state: 'off', message: '' }
let checked = false
const watchers = new Set<() => void>()
const notify = () => {
  for (const fn of watchers) fn()
}

async function api(route: string, body?: unknown) {
  const r = await fetch(`/__android/${route}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: 'no-store'
  })
  const json = await r.json().catch(() => null)
  if (!r.ok) throw new Error(json?.error ?? `Android answered ${r.status}`)
  return json
}

async function poll() {
  try {
    const s = await api('status')
    status = { reachable: true, sdk: s.sdk, state: s.state, message: s.message ?? '' }
  } catch {
    status = { reachable: false, sdk: false, state: 'off', message: '' }
  }
  checked = true
  if (status.state === 'running') open()
  else close()
  notify()
}

let timer: ReturnType<typeof setInterval> | undefined
let users = 0
/** The status, kept fresh while at least one live view is mounted. Returns the way to stop. */
export function watch(fn: () => void) {
  watchers.add(fn)
  return () => {
    watchers.delete(fn)
  }
}
export function keepFresh() {
  if (users++ === 0) {
    void poll()
    timer = setInterval(() => void poll(), 2000)
  }
  return () => {
    if (--users === 0) {
      clearInterval(timer)
      close()
    }
  }
}
export const current = () => status
export const hasChecked = () => checked

export async function start() {
  await api('start', {})
  status = { ...status, state: 'booting', message: '' }
  notify()
}
export async function stop() {
  await api('stop', {})
  await poll()
}
/** Installs an APK that is in the storage folder and opens it. */
export const run = (name: string) => api('run', { name }) as Promise<{ package: string; opened: boolean }>

// The screen. Frames are drawn into every registered canvas; a canvas that joins late asks for a fresh start of the
// stream, since a still screen sends nothing.
const canvases = new Set<HTMLCanvasElement>()
let socket: WebSocket | undefined
let decoder: VideoDecoder | undefined
let codec = ''
let pending: Uint8Array[] = []
let buffer = new Uint8Array(0)
let clock = 0
let sawFrame = false

export const canDecode = () => typeof VideoDecoder !== 'undefined'

export function nals(chunk: Uint8Array) {
  const joined = new Uint8Array(buffer.length + chunk.length)
  joined.set(buffer)
  joined.set(chunk, buffer.length)
  const starts: number[] = []
  // A four-byte start code holds a three-byte one: once found, step past it so it counts once.
  for (let i = 0; i + 3 < joined.length; i++) {
    if (joined[i] !== 0 || joined[i + 1] !== 0) continue
    if (joined[i + 2] === 0 && joined[i + 3] === 1) {
      starts.push(i)
      i += 3
    } else if (joined[i + 2] === 1) {
      starts.push(i)
      i += 2
    }
  }
  // The last unit may not be whole yet: it waits for the next chunk.
  const out: Uint8Array[] = []
  for (let k = 0; k + 1 < starts.length; k++) out.push(joined.subarray(starts[k]!, starts[k + 1]))
  buffer = joined.slice(starts.length ? starts.at(-1)! : Math.max(0, joined.length - 3))
  return out
}
export const type = (unit: Uint8Array) => unit[unit[2] === 1 ? 3 : 4]! & 0x1f

function feed(unit: Uint8Array) {
  const t = type(unit)
  if (t === 7) {
    const o = unit[2] === 1 ? 3 : 4
    const next = `avc1.${[unit[o + 1], unit[o + 2], unit[o + 3]].map((b) => b!.toString(16).padStart(2, '0')).join('')}`
    if (next !== codec || decoder?.state !== 'configured') {
      codec = next
      decoder?.configure({ codec, optimizeForLatency: true })
    }
    pending = [unit]
    return
  }
  if (t === 8) return void pending.push(unit)
  if (t !== 5 && t !== 1) return
  const parts = t === 5 ? [...pending, unit] : [unit]
  if (t === 5) pending = []
  if (decoder?.state !== 'configured') return
  const size = parts.reduce((n, p) => n + p.length, 0)
  const data = new Uint8Array(size)
  let at = 0
  for (const p of parts) {
    data.set(p, at)
    at += p.length
  }
  clock += 33_333
  decoder.decode(new EncodedVideoChunk({ type: t === 5 ? 'key' : 'delta', timestamp: clock, data }))
}

function draw(frame: VideoFrame) {
  sawFrame = true
  for (const canvas of canvases) {
    if (canvas.width !== frame.displayWidth) canvas.width = frame.displayWidth
    if (canvas.height !== frame.displayHeight) canvas.height = frame.displayHeight
    canvas.getContext('2d')?.drawImage(frame, 0, 0)
  }
  frame.close()
}

function open() {
  if (socket || !canvases.size || !canDecode()) return
  decoder = new VideoDecoder({ output: draw, error: () => reset() })
  buffer = new Uint8Array(0)
  pending = []
  sawFrame = false
  const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/__android/screen`)
  ws.binaryType = 'arraybuffer'
  ws.onmessage = (e) => {
    for (const unit of nals(new Uint8Array(e.data as ArrayBuffer))) feed(unit)
  }
  ws.onclose = () => {
    if (socket === ws) reset()
  }
  socket = ws
}
function close() {
  const ws = socket
  socket = undefined
  ws?.close()
  if (decoder && decoder.state !== 'closed') decoder.close()
  decoder = undefined
  codec = ''
}
function reset() {
  close()
  if (status.state === 'running' && canvases.size) setTimeout(open, 1000)
}

/** Draw the screen into this canvas until the returned function is called. */
export function show(canvas: HTMLCanvasElement) {
  canvases.add(canvas)
  if (status.state === 'running') {
    if (socket?.readyState === WebSocket.OPEN && sawFrame) socket.send(JSON.stringify({ t: 'refresh' }))
    open()
  }
  return () => {
    canvases.delete(canvas)
    if (!canvases.size) close()
  }
}

type Send = Record<string, unknown>
export const send = (message: Send) => {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message))
}

// Typing: a burst of characters goes as one message, so a word is one trip to the device, not a letter at a time.
let typed = ''
let flushing: ReturnType<typeof setTimeout> | undefined
function flush() {
  clearTimeout(flushing)
  flushing = undefined
  if (typed) send({ t: 'text', text: typed })
  typed = ''
}
export function typeText(text: string) {
  typed += text
  clearTimeout(flushing)
  flushing = setTimeout(flush, 60)
}
/** A key such as Enter or Backspace, after any text typed just before it. */
export function pressKey(code: number) {
  flush()
  send({ t: 'key', code })
}
