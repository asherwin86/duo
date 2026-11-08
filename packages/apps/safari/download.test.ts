import { expect, test } from 'bun:test'
import { downloadName, isPackage, megabytes } from './download.ts'

test('addresses ending in a package file are downloads, others are pages', () => {
  for (const url of [
    'https://example.com/app-release.apk',
    'https://example.com/a/b/Game.IPA?token=1',
    'https://example.com/bundle.xapk#x',
    'https://example.com/x.aab',
    'https://example.com/pkg.ipk'
  ])
    expect(isPackage(url)).toBe(true)
  for (const url of ['https://example.com/', 'https://example.com/apk', 'https://example.com/a.apk.html', 'not a url'])
    expect(isPackage(url)).toBe(false)
})

test('names are made safe for the file store', () => {
  expect(downloadName('https://example.com/dl/My%20App_v1.2.apk?x=1')).toBe('My App_v1.2.apk')
  expect(downloadName('https://example.com/a+b@c.apk')).toBe('a_b_c.apk')
  expect(downloadName('https://example.com/__.apk')).toBe('apk')
  expect(downloadName('https://example.com/')).toBe('download')
  const long = downloadName(`https://example.com/${'x'.repeat(300)}.apk`)
  expect(long.length).toBeLessThanOrEqual(120)
  expect(long.endsWith('.apk')).toBe(true)
  expect(/^[a-zA-Z0-9][\w.() -]*$/.test(downloadName('https://example.com/%E2%82%AC-café.apk'))).toBe(true)
})

test('sizes read as KB or MB', () => {
  expect(megabytes(100)).toBe('1 KB')
  expect(megabytes(512 * 1024)).toBe('512 KB')
  expect(megabytes(48.3 * 1024 * 1024)).toBe('48.3 MB')
})
