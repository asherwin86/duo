import { beforeAll, expect, test } from 'bun:test'
import { tmpdir } from 'node:os'
import { storage, storageFolder, validName } from './storage-folder.ts'

const ME = '127.0.0.1'
const base = 'http://localhost:3000/__storage'
const here = { host: 'localhost:3000' }
const call = (path: string, init: RequestInit & { headers?: Record<string, string> } = {}, peer: string | null = ME) =>
  storage(new Request(`${base}${path}`, { ...init, headers: { ...here, ...init.headers } }), peer) as Promise<Response>

beforeAll(() => {
  // These tests write files: they must be in the folder scripts/test-env.ts made, never the real one.
  expect(storageFolder.startsWith(tmpdir())).toBe(true)
})

test('a client on the network is refused even when its Host header says localhost', async () => {
  expect((await call('/downloads', {}, '192.168.0.114')).status).toBe(403)
  expect((await call('/downloads', { method: 'PUT', body: 'x' }, '192.168.0.114')).status).toBe(403)
  expect((await call('/downloads', {}, null)).status).toBe(403)
  expect((await call('/downloads')).status).toBe(200)
})

test('another website cannot send a request, including a text/plain POST that needs no preflight', async () => {
  const body = JSON.stringify({ url: 'http://127.0.0.1:9/x', name: 'planted.apk' })
  const evil = { origin: 'https://evil.example', 'content-type': 'text/plain' }
  expect((await call('/fetch', { method: 'POST', headers: evil, body })).status).toBe(403)
  expect(
    (await call('/downloads/x.apk', { method: 'PUT', headers: { origin: 'https://evil.example' }, body: 'x' })).status
  ).toBe(403)
  expect((await call('/downloads/x.apk', { method: 'DELETE', headers: { origin: 'null' } })).status).toBe(403)
  // the page's own request, but not JSON: refused before anything is fetched
  const own = { origin: 'http://localhost:3000', 'content-type': 'text/plain' }
  expect((await call('/fetch', { method: 'POST', headers: own, body })).status).toBe(415)
})

test('Windows device names are not file names, with or without an extension', () => {
  for (const name of ['NUL', 'nul', 'con.apk', 'CON', 'COM1.txt', 'lpt9', 'aux', 'PRN.tar.gz'])
    expect(validName(name), name).toBe(false)
  // Names that only start like one are fine.
  for (const name of ['console.txt', 'auxiliary.apk', 'com10.apk', 'comic.apk', 'null.apk', 'nul-2', 'my con.apk'])
    expect(validName(name), name).toBe(true)
})

test('a device name is refused by the API and nothing is created', async () => {
  for (const name of ['NUL', 'con.apk', 'COM1.txt', 'aux']) {
    const r = await call(`/downloads/${name}`, { method: 'PUT', body: 'x' })
    expect(r.status, name).toBe(400)
  }
  const list = (await (await call('/downloads')).json()) as { name: string }[]
  expect(list.map((f) => f.name)).toEqual([])
})

test('a malformed percent escape is a refusal, not an error', async () => {
  const r = await call('/downloads/%E0%A4%A')
  expect(r.status).toBe(400)
})

test('a file can still be saved, listed, read and deleted by this machine own page', async () => {
  const page = { origin: 'http://localhost:3000' }
  const put = await call('/downloads/hello%20world.apk', { method: 'PUT', headers: page, body: 'abc' })
  expect(put.status).toBe(200)
  expect(((await put.json()) as { name: string; size: number }).size).toBe(3)
  const list = (await (await call('/downloads')).json()) as { name: string }[]
  expect(list.map((f) => f.name)).toEqual(['hello world.apk'])
  expect(await (await call('/downloads/hello%20world.apk')).text()).toBe('abc')
  expect((await call('/downloads/hello%20world.apk', { method: 'DELETE', headers: page })).status).toBe(204)
  expect(((await (await call('/downloads')).json()) as unknown[]).length).toBe(0)
})
