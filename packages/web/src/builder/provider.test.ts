import { afterEach, expect, test } from 'bun:test'
import { example } from './example'
import { completion, endpointURL } from './provider'
import { parseResponse, parseSource } from './types'

const original = globalThis.fetch
afterEach(() => {
  globalThis.fetch = original
})
const connection = { endpoint: 'https://provider.example/v1/', model: 'test', key: 'test-only-secret' }
const messages = [{ role: 'user' as const, content: 'Make a timer' }]
function response(chunks: string[], type = 'text/event-stream') {
  return new Response(
    new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk))
        controller.close()
      }
    }),
    { headers: { 'Content-Type': type } }
  )
}
test('direct requests omit cookies, refuse redirects and keep the key out of the body', async () => {
  globalThis.fetch = (async (url, options) => {
    expect(url).toBe('https://provider.example/v1/chat/completions')
    expect(options?.credentials).toBe('omit')
    expect(options?.redirect).toBe('error')
    expect(options?.body).not.toContain(connection.key)
    expect(new Headers(options?.headers).get('Authorization')).toBe(`Bearer ${connection.key}`)
    return response([
      'data: {"choices":[{"delta":{"content":"Hi"}}]}\r',
      '\n\r\n',
      'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n'
    ])
  }) as typeof fetch
  expect(await completion(connection, messages, new AbortController().signal)).toBe('Hi')
})
test('accepts a non-streaming compatible provider', async () => {
  globalThis.fetch = (async () =>
    response(['{"choices":[{"message":{"content":"OK"},"finish_reason":"stop"}]}'], 'application/json')) as typeof fetch
  expect(await completion(connection, messages, new AbortController().signal)).toBe('OK')
})
test('truncation and disconnected streams never become revisions', async () => {
  globalThis.fetch = (async () =>
    response(['data: {"choices":[{"delta":{"content":"partial"},"finish_reason":"length"}]}\n\n'])) as typeof fetch
  await expect(completion(connection, messages, new AbortController().signal)).rejects.toThrow('truncated')
  globalThis.fetch = (async () => response(['data: {"choices":[{"delta":{"content":"partial"}}]}\n\n'])) as typeof fetch
  await expect(completion(connection, messages, new AbortController().signal)).rejects.toThrow(
    'before a complete response'
  )
})
test('the connection test accepts a reply that stops at its token cap, even an empty one', async () => {
  globalThis.fetch = (async () =>
    response(['data: {"choices":[{"delta":{"content":"O"},"finish_reason":"length"}]}\n\n'])) as typeof fetch
  expect(await completion(connection, messages, new AbortController().signal, undefined, true)).toBe('O')
  globalThis.fetch = (async () =>
    response(['data: {"choices":[{"delta":{},"finish_reason":"length"}]}\n\n'])) as typeof fetch
  expect(await completion(connection, messages, new AbortController().signal, undefined, true)).toBe('')
  globalThis.fetch = (async () =>
    response(['data: {"choices":[{"delta":{"content":"O"},"finish_reason":"length"}]}\n\n'])) as typeof fetch
  await expect(completion(connection, messages, new AbortController().signal)).rejects.toThrow('truncated')
})
test('OpenAI is asked with max_completion_tokens, and a 400 naming the other spelling is retried once', async () => {
  const bodies: Record<string, unknown>[] = []
  globalThis.fetch = (async (_url, options) => {
    bodies.push(JSON.parse(String(options?.body)))
    return response(['data: {"choices":[{"delta":{"content":"Hi"},"finish_reason":"stop"}]}\n\n', 'data: [DONE]\n\n'])
  }) as typeof fetch
  const openai = { ...connection, endpoint: 'https://api.openai.com/v1' }
  await completion(openai, messages, new AbortController().signal)
  expect(bodies[0]).toHaveProperty('max_completion_tokens', 12000)
  expect(bodies[0]).not.toHaveProperty('max_tokens')
  bodies.length = 0
  globalThis.fetch = (async (_url, options) => {
    const body = JSON.parse(String(options?.body))
    bodies.push(body)
    if ('max_tokens' in body)
      return new Response("Unsupported parameter: 'max_tokens'. Use 'max_completion_tokens' instead.", { status: 400 })
    return response(['data: {"choices":[{"delta":{"content":"Hi"},"finish_reason":"stop"}]}\n\n', 'data: [DONE]\n\n'])
  }) as typeof fetch
  expect(await completion(connection, messages, new AbortController().signal)).toBe('Hi')
  expect(bodies).toHaveLength(2)
  expect(bodies[1]).toHaveProperty('max_completion_tokens', 12000)
})
test('an unexplained 400 says what to check and is not retried', async () => {
  let calls = 0
  globalThis.fetch = (async () => {
    calls++
    return new Response('model not found', { status: 400 })
  }) as typeof fetch
  await expect(completion(connection, messages, new AbortController().signal)).rejects.toThrow('Check the model ID')
  expect(calls).toBe(1)
})
test('does not display provider error bodies containing credentials', async () => {
  globalThis.fetch = (async () => new Response(connection.key, { status: 401 })) as typeof fetch
  await expect(completion(connection, messages, new AbortController().signal)).rejects.toThrow('API key was rejected')
})
test('endpoint credentials, fragments, queries and insecure transport are refused', () => {
  for (const url of [
    'http://example.com/v1',
    'https://user:pass@example.com/v1',
    'https://example.com/v1?k=secret',
    'https://example.com/v1#secret'
  ])
    expect(() => endpointURL(url)).toThrow()
})
test('source schema rejects traversal, executable HTML and oversized projects', () => {
  expect(parseResponse(`\`\`\`json\n${JSON.stringify(example)}\n\`\`\``).name).toBe('Focus')
  for (const files of [
    { '../app.tsx': '' },
    { 'app.tsx': '', 'escape.html': '<script />' },
    { 'app.tsx': 'x'.repeat(180_001) }
  ])
    expect(() => parseSource({ ...example, files })).toThrow()
})
