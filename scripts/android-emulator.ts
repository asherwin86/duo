// An Android emulator the dev server runs for the phone, and the screen it streams.
//
// A browser tab cannot run Android, so the real Android Emulator (Google's, from the Android SDK) runs on this
// computer beside the dev server. The server starts it with no window, installs an APK from the storage folder,
// streams the screen out as H.264 over a WebSocket and turns taps and swipes from the page back into `adb input`.
// Nothing here exists on a built site: no server, no emulator.
//
// Only this machine's own page may use it: the Host must be local and a WebSocket or POST must come from the
// same origin, because a WebSocket is not stopped by CORS and this starts programs.

import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { ServerWebSocket } from 'bun'
import { storageFolder } from './storage-folder.ts'

const win = process.platform === 'win32'
const SDK = [
  process.env.ANDROID_HOME,
  process.env.ANDROID_SDK_ROOT,
  join(process.env.LOCALAPPDATA ?? '', 'Android', 'Sdk'),
  join(process.env.HOME ?? '', 'Library', 'Android', 'sdk'),
  join(process.env.HOME ?? '', 'Android', 'Sdk')
].find((p) => p && existsSync(join(p, 'platform-tools')))
const exe = (path: string) => (win ? `${path}.exe` : path)
const tool = {
  adb: SDK && exe(join(SDK, 'platform-tools', 'adb')),
  emulator: SDK && exe(join(SDK, 'emulator', 'emulator'))
}
const aapt2 = () => {
  if (!SDK) return undefined
  const dir = join(SDK, 'build-tools')
  const newest = existsSync(dir) ? readdirSync(dir).sort().at(-1) : undefined
  return newest ? exe(join(dir, newest, 'aapt2')) : undefined
}

/**
 * The Android 14 image to run, newest preference first. The Google Play one lets the person sign in and install apps
 * from the Play Store; it is a virtual phone of its own, so the plain one and what is installed on it stay as they were.
 */
const IMAGES = [
  { avd: 'duo-play', dir: 'google_apis_playstore', play: true, label: 'Google Play' },
  { avd: 'duo', dir: 'google_apis', play: false, label: 'Google APIs' }
] as const
type Image = (typeof IMAGES)[number]
const chooseImage = (): Image | undefined =>
  IMAGES.find((i) => existsSync(join(SDK ?? '', 'system-images', 'android-34', i.dir, 'x86_64')))
const PORT = 5580
const SERIAL = `emulator-${PORT}`
/** What the stream is encoded at: a quarter of the pixels of a 1080 by 2400 screen, both sides multiples of 16. */
const LONG_SIDE = 1280
/** Both sides of the encoded stream, in multiples of 16 as the encoder wants, with the long side at LONG_SIDE. */
const streamSize = () => {
  const scale = LONG_SIDE / Math.max(size.width, size.height)
  const round = (n: number) => Math.max(16, Math.round((n * scale) / 16) * 16)
  return { width: round(size.width), height: round(size.height) }
}

const env = () => ({ ...process.env, ANDROID_HOME: SDK, ANDROID_SDK_ROOT: SDK })

type State = 'off' | 'booting' | 'running'
let state: State = 'off'
let message = ''
/** Whether the running (or next) Android has the Play Store. */
let play = false
let emulator: ReturnType<typeof Bun.spawn> | undefined
let size = { width: 1080, height: 2400 }

async function run(cmd: string[], timeout = 60_000) {
  const proc = Bun.spawn(win && cmd[0]?.endsWith('.bat') ? ['cmd.exe', '/c', ...cmd] : cmd, {
    env: env(),
    stdout: 'pipe',
    stderr: 'pipe',
    stdin: 'ignore'
  })
  const timer = setTimeout(() => proc.kill(), timeout)
  const [out, err] = await Promise.all([
    new Response(proc.stdout as ReadableStream).text(),
    new Response(proc.stderr as ReadableStream).text()
  ])
  const code = await proc.exited
  clearTimeout(timer)
  return { code, out: out.trim(), err: err.trim() }
}
const adb = (...args: string[]) => run([tool.adb!, '-s', SERIAL, ...args])

/**
 * The virtual device is two small files the emulator reads, written here rather than through avdmanager, which
 * cannot be called portably with a package name that holds semicolons. A phone-shaped Pixel 6 on Android 14.
 */
async function ensureAvd(image: Image) {
  const AVD = image.avd
  const home = process.env.ANDROID_AVD_HOME ?? join(homedir(), '.android', 'avd')
  const dir = join(home, `${AVD}.avd`)
  if (existsSync(join(dir, 'config.ini'))) return
  mkdirSync(dir, { recursive: true })
  writeFileSync(
    join(home, `${AVD}.ini`),
    ['avd.ini.encoding=UTF-8', `path=${dir}`, `path.rel=avd/${AVD}.avd`, 'target=android-34', ''].join('\n')
  )
  writeFileSync(
    join(dir, 'config.ini'),
    [
      `AvdId=${AVD}`,
      `PlayStore.enabled=${image.play}`,
      'abi.type=x86_64',
      `avd.ini.displayname=Duo Android${image.play ? ' (Google Play)' : ''}`,
      'avd.ini.encoding=UTF-8',
      `disk.dataPartition.size=${image.play ? '12G' : '6G'}`,
      'hw.accelerometer=yes',
      'hw.audioInput=no',
      'hw.audioOutput=no',
      'hw.battery=yes',
      'hw.camera.back=none',
      'hw.camera.front=none',
      'hw.cpu.arch=x86_64',
      'hw.cpu.ncore=4',
      'hw.device.manufacturer=Google',
      'hw.device.name=pixel_6',
      'hw.gps=yes',
      'hw.gpu.enabled=yes',
      'hw.gpu.mode=auto',
      'hw.initialOrientation=portrait',
      'hw.keyboard=yes',
      'hw.lcd.density=420',
      'hw.lcd.height=2400',
      'hw.lcd.width=1080',
      'hw.mainKeys=no',
      `hw.ramSize=${image.play ? 3072 : 2048}`,
      'hw.sdCard=no',
      'hw.sensors.orientation=yes',
      'hw.trackBall=no',
      `image.sysdir.1=system-images/android-34/${image.dir}/x86_64/`,
      'runtime.network.latency=none',
      'runtime.network.speed=full',
      `tag.display=${image.label}`,
      `tag.id=${image.dir}`,
      ''
    ].join('\n')
  )
}

/**
 * The screen's size as it is held now: a game that turns the phone sideways swaps the two, and taps are measured
 * in the turned screen. Read from the display service, which reports the rotated size directly.
 */
async function readSize() {
  const found = (await adb('shell', 'dumpsys', 'display')).out.match(/deviceWidth=(\d+), deviceHeight=(\d+)/)
  if (!found) return false
  const next = { width: Number(found[1]), height: Number(found[2]) }
  const changed = next.width !== size.width || next.height !== size.height
  size = next
  return changed
}
/** While anyone is watching, a turn of the screen restarts the stream at its new shape. */
setInterval(async () => {
  if (state === 'running' && clients.size && (await readSize().catch(() => false))) startRecord()
}, 1500)

async function start() {
  if (state !== 'off') return
  if (!tool.adb || !existsSync(tool.emulator!)) throw new Error('The Android SDK is not installed')
  state = 'booting'
  message = 'Starting Android…'
  try {
    const image = chooseImage()
    if (!image) throw new Error('The Android 14 system image is not installed')
    await ensureAvd(image)
    play = image.play
    emulator = Bun.spawn(
      [
        tool.emulator!,
        '-avd',
        image.avd,
        '-port',
        String(PORT),
        '-no-window',
        '-no-audio',
        '-no-snapshot',
        '-no-boot-anim',
        '-gpu',
        process.env.DUO_ANDROID_GPU ?? 'host',
        '-netdelay',
        'none',
        '-netspeed',
        'full'
      ],
      { env: env(), stdout: 'pipe', stderr: 'pipe', stdin: 'ignore' }
    )
    // The emulator says why it will not run (no hardware acceleration, a missing image) on its output.
    let tail = ''
    for (const stream of [emulator.stdout, emulator.stderr] as ReadableStream<Uint8Array>[]) {
      void (async () => {
        const decoder = new TextDecoder()
        for await (const chunk of stream) tail = (tail + decoder.decode(chunk)).slice(-2000)
      })()
    }
    void emulator.exited.then((code) => {
      if (state === 'booting')
        message = `Android stopped while starting (${code}). ${tail
          .split(/\r?\n/)
          .filter((l) => /ERROR|FATAL|acceleration|accel|HAXM|WHPX|Hyper-V/i.test(l))
          .slice(-2)
          .join(' ')}`.trim()
      state = 'off'
      emulator = undefined
      stopRecord()
    })
    const deadline = Date.now() + 5 * 60_000
    while (state === 'booting' && Date.now() < deadline) {
      await Bun.sleep(2000)
      if (!emulator) return
      const booted = await adb('shell', 'getprop', 'sys.boot_completed').catch(() => undefined)
      if (booted?.out === '1') {
        await readSize()
        // Stay awake and unlocked: nobody is at the screen to wake it.
        await adb('shell', 'settings', 'put', 'global', 'stay_on_while_plugged_in', '7').catch(() => {})
        await adb('shell', 'input', 'keyevent', '82').catch(() => {})
        state = 'running'
        message = ''
        if (clients.size) startRecord()
        return
      }
    }
    if (state === 'booting') {
      message = 'Android did not finish starting in five minutes'
      await stop()
    }
  } catch (e) {
    message = e instanceof Error ? e.message : 'Android could not start'
    state = 'off'
  }
}

async function stop() {
  stopRecord()
  if (tool.adb && state !== 'off') await adb('emu', 'kill').catch(() => {})
  emulator?.kill()
  state = 'off'
  emulator = undefined
}

/** Installs an APK from the storage folder and opens it. Returns what was installed. */
async function launch(name: string) {
  if (state !== 'running') throw new Error('Android is not running')
  const file = join(storageFolder, name)
  if (!/^[^/\\]+\.(apk)$/i.test(name) || !existsSync(file)) throw new Error('That APK is not in the storage folder')
  const parse = aapt2()
  const pkg = parse ? (await run([parse, 'dump', 'packagename', file])).out : ''
  const install = await adb('install', '-r', '-t', '-g', file)
  if (install.code !== 0 || !/Success/i.test(install.out)) {
    const reason = `${install.out} ${install.err}`.match(/\[(INSTALL_[A-Z_]+[^\]]*)\]|Failure \[([^\]]+)\]/)
    throw new Error(`Android refused the APK${reason ? `: ${reason[1] ?? reason[2]}` : ''}`)
  }
  if (!pkg) return { package: '', opened: false }
  await adb('shell', 'monkey', '-p', pkg, '-c', 'android.intent.category.LAUNCHER', '1')
  return { package: pkg, opened: true }
}

// The screen. screenrecord ends after a few minutes and a page that joins late needs the start of a stream, so a
// new client restarts it and the end of one starts the next.
const clients = new Set<ServerWebSocket<unknown>>()
let record: ReturnType<typeof Bun.spawn> | undefined
function stopRecord() {
  record?.kill()
  record = undefined
}
function startRecord() {
  stopRecord()
  if (state !== 'running' || !clients.size) return
  const proc = Bun.spawn(
    [
      tool.adb!,
      '-s',
      SERIAL,
      'exec-out',
      'screenrecord',
      '--output-format=h264',
      '--size',
      `${streamSize().width}x${streamSize().height}`,
      '--bit-rate',
      '5000000',
      '--time-limit',
      '170',
      '-'
    ],
    { stdout: 'pipe', stderr: 'ignore', stdin: 'ignore' }
  )
  record = proc
  void (async () => {
    for await (const chunk of proc.stdout as ReadableStream<Uint8Array>) for (const ws of clients) ws.sendBinary(chunk)
    if (record === proc) {
      record = undefined
      startRecord()
    }
  })()
}

type Input =
  | { t: 'tap'; x: number; y: number }
  | { t: 'swipe'; x1: number; y1: number; x2: number; y2: number; ms: number }
  | { t: 'key'; code: number }
  | { t: 'text'; text: string }
const clamp = (n: unknown) => Math.min(1, Math.max(0, Number(n) || 0))
const px = (v: unknown, axis: 'width' | 'height') => Math.round(clamp(v) * (size[axis] - 1))
/**
 * The `adb shell input` calls that type some text. Printable ASCII only, which is all `input text` types. The
 * device's shell reads the line, so each piece is quoted whole, and a space is %s to `input text`. A backslash is a
 * key press of its own: the device reads one followed by digits as an octal character code. The text is never
 * logged: it may be a password.
 */
export function textSteps(text: unknown): string[][] {
  const steps: string[][] = []
  String(text)
    .slice(0, 400)
    .replace(/[^ -~]/g, '')
    .split('\\')
    .forEach((part, k) => {
      if (k > 0) steps.push(['keyevent', '73'])
      const typed = part.replace(/'/g, `'\\''`).replace(/ /g, '%s')
      if (typed) steps.push(['text', `'${typed}'`])
    })
  return steps
}
/** Home, Back, Recents, Menu, Tab, Enter, the arrows, Backspace and Delete. */
const KEYS = new Set([3, 4, 187, 82, 61, 66, 19, 20, 21, 22, 67, 112])
let shell: Promise<unknown> = Promise.resolve()
function input(message: Input) {
  if (state !== 'running') return
  const go = (...args: string[]) => (shell = shell.then(() => adb('shell', 'input', ...args)).catch(() => {}))
  switch (message.t) {
    case 'tap':
      return go('tap', String(px(message.x, 'width')), String(px(message.y, 'height')))
    case 'swipe':
      return go(
        'swipe',
        String(px(message.x1, 'width')),
        String(px(message.y1, 'height')),
        String(px(message.x2, 'width')),
        String(px(message.y2, 'height')),
        String(Math.min(3000, Math.max(30, Math.round(message.ms) || 200)))
      )
    case 'key':
      // The keys a person needs to move around and fill a form; the rest of the keyboard is not the page's to press.
      return KEYS.has(message.code) ? go('keyevent', String(message.code)) : undefined
    case 'text':
      for (const step of textSteps(message.text)) go(...step)
      return
  }
}

const local = (host: string) => /^(localhost|127\.0\.0\.1|\[::1\]|[\w-]+\.localhost)(:\d+)?$/.test(host)
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

/** True when this request is for the emulator's screen and should be upgraded to a WebSocket. */
export const wantsScreen = (req: Request) =>
  new URL(req.url).pathname === '/__android/screen' && req.headers.get('upgrade') === 'websocket'

/** Same machine, and (for anything that acts) the same site: a WebSocket skips CORS, so the Origin is checked. */
export function allowed(req: Request) {
  const host = req.headers.get('host') ?? ''
  if (!local(host)) return false
  const origin = req.headers.get('origin')
  return !origin || new URL(origin).host === host
}

export const screen = {
  open(ws: ServerWebSocket<unknown>) {
    clients.add(ws)
    startRecord()
  },
  message(_ws: ServerWebSocket<unknown>, data: string | Buffer) {
    try {
      const message = JSON.parse(String(data)) as Input | { t: 'refresh' }
      // A canvas that joins a still screen asks for the stream to start again, so its first frame comes.
      if (message.t === 'refresh') startRecord()
      else input(message)
    } catch {
      /* A malformed message is ignored. */
    }
  },
  close(ws: ServerWebSocket<unknown>) {
    clients.delete(ws)
    if (!clients.size) stopRecord()
  }
}

/** The /__android/ JSON API, or `undefined` for a request that is not for it. */
export async function android(req: Request): Promise<Response | undefined> {
  const url = new URL(req.url)
  if (!url.pathname.startsWith('/__android/') || url.pathname === '/__android/screen') return undefined
  if (!allowed(req)) return json({ error: 'The emulator is only served to this machine' }, 403)
  const route = url.pathname.slice('/__android/'.length)
  if (route === 'status' && req.method === 'GET')
    return json({
      sdk: Boolean(tool.adb && tool.emulator && existsSync(tool.emulator)),
      state,
      message,
      size: streamSize(),
      play: state === 'off' ? Boolean(chooseImage()?.play) : play,
      hint: SDK ?? null
    })
  if (req.method !== 'POST') return json({ error: 'Not supported' }, 405)
  try {
    if (route === 'start') {
      void start()
      return json({ state })
    }
    if (route === 'stop') {
      await stop()
      return json({ state })
    }
    if (route === 'run') {
      const body = (await req.json().catch(() => null)) as { name?: unknown } | null
      if (typeof body?.name !== 'string') return json({ error: 'A file name is needed' }, 400)
      return json(await launch(body.name))
    }
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'That did not work' }, 500)
  }
  return json({ error: 'Not supported' }, 404)
}

process.on('exit', () => {
  record?.kill()
  emulator?.kill()
})
