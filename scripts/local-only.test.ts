import { expect, test } from 'bun:test'
import { fromThisMachine, isLoopbackAddress } from './local-only.ts'

const request = (headers: Record<string, string>) => new Request('http://localhost:3000/__storage/info', { headers })
const host = { host: 'localhost:3000' }

test('only the machine itself is a loopback address', () => {
  for (const ok of ['127.0.0.1', '127.1.2.3', '::1', '::ffff:127.0.0.1']) expect(isLoopbackAddress(ok)).toBe(true)
  for (const no of ['192.168.0.114', '10.0.0.2', '::ffff:192.168.0.114', 'fe80::1', '1270.0.0.1', '', null, undefined])
    expect(isLoopbackAddress(no)).toBe(false)
})

test('a client on the network cannot claim to be local by writing a Host header', () => {
  expect(fromThisMachine(request(host), '127.0.0.1')).toBe(true)
  expect(fromThisMachine(request(host), '::1')).toBe(true)
  expect(fromThisMachine(request(host), '192.168.0.114')).toBe(false)
  expect(fromThisMachine(request(host), undefined)).toBe(false)
})

test('the Host has to name this machine, whoever is connected', () => {
  expect(fromThisMachine(request({ host: 'duo.localhost:3000' }), '127.0.0.1')).toBe(true)
  expect(fromThisMachine(request({ host: '192.168.0.114:3000' }), '127.0.0.1')).toBe(false)
  expect(fromThisMachine(request({ host: 'rebind.example:3000' }), '127.0.0.1')).toBe(false)
  expect(fromThisMachine(request({}), '127.0.0.1')).toBe(false)
})

test('an Origin has to be this page, and one that cannot be read is refused rather than thrown at', () => {
  expect(fromThisMachine(request({ ...host, origin: 'http://localhost:3000' }), '127.0.0.1')).toBe(true)
  expect(fromThisMachine(request({ ...host, origin: 'https://evil.example' }), '127.0.0.1')).toBe(false)
  expect(fromThisMachine(request({ ...host, origin: 'http://localhost:4000' }), '127.0.0.1')).toBe(false)
  expect(fromThisMachine(request({ ...host, origin: 'null' }), '127.0.0.1')).toBe(false)
  expect(fromThisMachine(request({ ...host, origin: 'not a url' }), '127.0.0.1')).toBe(false)
})
