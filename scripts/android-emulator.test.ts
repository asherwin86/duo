import { expect, test } from 'bun:test'
import { allowed, restartDelay, textSteps } from './android-emulator.ts'

test('text is quoted whole for the device shell, with spaces as %s', () => {
  expect(textSteps('hello world')).toEqual([['text', "'hello%sworld'"]])
  // A single quote closes the quoting, is escaped, and opens it again.
  expect(textSteps(`it's "ok" $x & (y); <a|b> 100%`)).toEqual([
    ['text', String.raw`'it'\''s%s"ok"%s$x%s&%s(y);%s<a|b>%s100%'`]
  ])
})

test('a backslash is its own key press, never part of the text', () => {
  expect(textSteps(String.raw`a\b`)).toEqual([
    ['text', "'a'"],
    ['keyevent', '73'],
    ['text', "'b'"]
  ])
  // Digits after a backslash must not become an octal escape on the device.
  expect(textSteps(String.raw`50\50`)).toEqual([
    ['text', "'50'"],
    ['keyevent', '73'],
    ['text', "'50'"]
  ])
  expect(textSteps('\\')).toEqual([['keyevent', '73']])
})

test('only printable ASCII is sent, and no more than 400 characters', () => {
  expect(textSteps('café\u{1f600}\n\t')).toEqual([['text', "'caf'"]])
  expect(textSteps('x'.repeat(1000))).toEqual([['text', `'${'x'.repeat(400)}'`]])
  expect(textSteps('')).toEqual([])
})

test('the emulator is only for this machine own page: the address, the Host and the Origin', () => {
  const post = (headers: Record<string, string>) =>
    new Request('http://localhost:3000/__android/start', { method: 'POST', headers })
  const host = { host: 'localhost:3000' }
  expect(allowed(post(host), '127.0.0.1')).toBe(true)
  expect(allowed(post({ ...host, origin: 'http://localhost:3000' }), '::1')).toBe(true)
  expect(allowed(post(host), '192.168.0.114')).toBe(false)
  expect(allowed(post({ ...host, origin: 'https://evil.example' }), '127.0.0.1')).toBe(false)
  // an opaque origin used to throw out of the check instead of being refused
  expect(allowed(post({ ...host, origin: 'null' }), '127.0.0.1')).toBe(false)
})

test('a screen recording that ends at once is not restarted at once', () => {
  expect(restartDelay(0)).toBeGreaterThan(0)
  expect(restartDelay(2999)).toBeGreaterThan(0)
  // one that ran its full length is followed by the next with no gap
  expect(restartDelay(170_000)).toBe(0)
})
