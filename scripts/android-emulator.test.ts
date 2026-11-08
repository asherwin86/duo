import { expect, test } from 'bun:test'
import { textSteps } from './android-emulator.ts'

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
