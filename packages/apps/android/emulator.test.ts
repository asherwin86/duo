import { expect, test } from 'bun:test'
import { nals, type } from './emulator.ts'

// A stream arrives in arbitrary pieces; a unit is only handed over once the next start code proves it ended.
test('H.264 units are split on start codes, across chunk boundaries', () => {
  const sps = [0, 0, 0, 1, 0x67, 1, 2, 3]
  const pps = [0, 0, 1, 0x68, 9]
  const idr = [0, 0, 0, 1, 0x65, 7, 7, 7]
  const next = [0, 0, 0, 1, 0x41, 5]
  const stream = Uint8Array.from([...sps, ...pps, ...idr, ...next])
  const out: Uint8Array[] = []
  // Cut it in the middle of a start code and of a unit.
  for (const [from, to] of [
    [0, 6],
    [6, 13],
    [13, stream.length]
  ] as const)
    out.push(...nals(stream.slice(from, to)))
  expect(out.map(type)).toEqual([7, 8, 5])
  expect([...out[0]!]).toEqual(sps)
  expect([...out[1]!]).toEqual(pps)
  expect([...out[2]!]).toEqual(idr)
  // The last unit is held back until another start code arrives.
  expect(nals(Uint8Array.from([0, 0, 0, 1, 0x41, 6])).map(type)).toEqual([1])
})
