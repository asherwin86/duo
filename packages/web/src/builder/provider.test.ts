import { afterEach, expect, test } from 'bun:test'
import { example } from './example'
import {
  completion,
  contextWindow,
  endpointURL,
  isLoopback,
  isOllama,
  LOCAL_MEMORY,
  PROVIDERS,
  suggestModel
} from './provider'
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
test('a Gemini key that does not offer the chosen model gets the alias, else the newest plain Flash', () => {
  const google = 'https://generativelanguage.googleapis.com/v1beta/openai'
  expect(suggestModel(google, ['gemini-2.5-pro', 'gemini-flash-latest', 'gemini-3.5-flash'])).toBe(
    'gemini-flash-latest'
  )
  expect(
    suggestModel(google, ['gemini-2.5-flash', 'gemini-3.5-flash', 'gemini-3.5-flash-lite', 'gemini-3.5-flash-image'])
  ).toBe('gemini-3.5-flash')
  expect(suggestModel(google, ['gemini-2.5-pro'])).toBeUndefined()
  expect(suggestModel('https://api.openai.com/v1', ['gpt-5', 'gemini-flash-latest'])).toBeUndefined()
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
test('plain http is accepted for a server on this computer and nowhere else', () => {
  expect(endpointURL('http://localhost:11434/v1')).toBe('http://localhost:11434/v1/chat/completions')
  expect(endpointURL('http://127.0.0.1:3000/api/')).toBe('http://127.0.0.1:3000/api/chat/completions')
  expect(endpointURL('http://[::1]:11434/v1')).toBe('http://[::1]:11434/v1/chat/completions')
  expect(isLoopback('http://localhost.evil.example/v1')).toBe(false)
  expect(isLoopback('http://127.0.0.1.evil.example/v1')).toBe(false)
  expect(isLoopback('http://192.168.1.20:11434/v1')).toBe(false)
  expect(() => endpointURL('http://192.168.1.20:11434/v1')).toThrow()
  expect(() => endpointURL('http://user:pass@localhost/v1')).toThrow()
})
test('a local server needs no key, and no Authorization header is sent without one', async () => {
  let headers: Headers | undefined
  globalThis.fetch = (async (_url, options) => {
    headers = new Headers(options?.headers)
    return response(['data: {"choices":[{"delta":{"content":"Hi"},"finish_reason":"stop"}]}\n\n', 'data: [DONE]\n\n'])
  }) as typeof fetch
  const local = { endpoint: 'http://localhost:8080/v1', model: 'some-model', key: '' }
  expect(await completion(local, messages, new AbortController().signal)).toBe('Hi')
  expect(headers?.has('Authorization')).toBe(false)
  // A hosted provider without a key is still refused before any request is made.
  await expect(completion({ ...connection, key: '' }, messages, new AbortController().signal)).rejects.toThrow(
    'API key'
  )
})
test('Ollama is asked through /api/chat with a window big enough for the prompt, and its stream is read', async () => {
  let seen: { url: string; body: Record<string, unknown> } | undefined
  globalThis.fetch = (async (url, options) => {
    seen = { url: String(url), body: JSON.parse(String(options?.body)) }
    // A line split across two chunks, as a real network delivers it.
    return response(
      [
        '{"message":{"role":"assistant","content":"He"},"done":false}\n{"message":{"role":"assis',
        'tant","content":"llo"},"done":false}\n',
        '{"message":{"role":"assistant","content":""},"done":true,"done_reason":"stop"}\n'
      ],
      'application/x-ndjson'
    )
  }) as typeof fetch
  const ollama = { endpoint: 'http://localhost:11434/v1', model: 'mistral:latest', key: '' }
  const big = [{ role: 'user' as const, content: 'x'.repeat(40_000) }]
  expect(await completion(ollama, big, new AbortController().signal)).toBe('Hello')
  expect(seen?.url).toBe('http://localhost:11434/api/chat')
  expect(seen?.body.think).toBe(false)
  const options = seen?.body.options as { num_ctx: number; num_predict: number }
  // A reply from this computer has no cap: it ends when the model says it is done.
  expect(options.num_predict).toBe(-1)
  // 40,000 characters is about 13,400 tokens, and the reply needs 12,000 more.
  expect(options.num_ctx).toBe(32768)
  expect(seen?.body).not.toHaveProperty('max_tokens')
})
test('a local reply that is cut off is carried on from where it stopped, until the model says it is done', async () => {
  const ollama = { endpoint: 'http://localhost:11434/v1', model: 'm', key: '' }
  const sent: { role: string; content: string }[][] = []
  const rounds = [
    '{"message":{"content":"ab"},"done":true,"done_reason":"length"}\n',
    '{"message":{"content":"cd"},"done":true,"done_reason":"length"}\n',
    '{"message":{"content":"ef"},"done":true,"done_reason":"stop"}\n'
  ]
  globalThis.fetch = (async (_url, options) => {
    sent.push(JSON.parse(String(options?.body)).messages)
    return response([rounds[sent.length - 1]!], 'application/x-ndjson')
  }) as typeof fetch
  const seen: number[] = []
  expect(await completion(ollama, messages, new AbortController().signal, (n) => seen.push(n))).toBe('abcdef')
  expect(sent).toHaveLength(3)
  // Each round is the same conversation with the answer so far as the model's own half-finished turn.
  expect(sent[0]).toEqual(messages)
  expect(sent[1]?.at(-1)).toEqual({ role: 'assistant', content: 'ab' })
  expect(sent[2]?.at(-1)).toEqual({ role: 'assistant', content: 'abcd' })
  // Progress counts the whole answer, not each round.
  expect(seen.at(-1)).toBe(6)
})
test('a hosted reply cut off at its cap is still refused, and a local round that adds nothing is not repeated', async () => {
  globalThis.fetch = (async () =>
    response(['data: {"choices":[{"delta":{"content":"part"},"finish_reason":"length"}]}\n\n'])) as typeof fetch
  await expect(completion(connection, messages, new AbortController().signal)).rejects.toThrow('truncated')
  const ollama = { endpoint: 'http://localhost:11434/v1', model: 'm', key: '' }
  let calls = 0
  globalThis.fetch = (async () => {
    calls++
    return response(['{"message":{"content":""},"done":true,"done_reason":"length"}\n'], 'application/x-ndjson')
  }) as typeof fetch
  await expect(completion(ollama, messages, new AbortController().signal)).rejects.toThrow('without finishing')
  expect(calls).toBe(1)
})
test('a local prompt too big for the model memory is refused before it is sent, and an error line is reported', async () => {
  const ollama = { endpoint: 'http://localhost:11434/v1', model: 'm', key: '' }
  let calls = 0
  globalThis.fetch = (async () => {
    calls++
    return response(['{"error":"model requires more memory"}\n'], 'application/x-ndjson')
  }) as typeof fetch
  await expect(
    completion(ollama, [{ role: 'user', content: 'x'.repeat(LOCAL_MEMORY + 1) }], new AbortController().signal)
  ).rejects.toThrow('more than the model can keep')
  expect(calls).toBe(0)
  await expect(completion(ollama, messages, new AbortController().signal)).rejects.toThrow('generation error')
})
test('a local request has no timeout, a hosted one does', async () => {
  const signals: (AbortSignal | undefined)[] = []
  globalThis.fetch = (async (_url, options) => {
    signals.push(options?.signal ?? undefined)
    return response(['data: {"choices":[{"delta":{"content":"x"},"finish_reason":"stop"}]}\n\n'])
  }) as typeof fetch
  const stop = new AbortController()
  await completion({ endpoint: 'http://localhost:8080/v1', model: 'm', key: '' }, messages, stop.signal)
  await completion(connection, messages, stop.signal)
  // The local request listens to the person's Stop and nothing else; the hosted one also has a clock.
  expect(signals[0]).toBe(stop.signal)
  expect(signals[1]).not.toBe(stop.signal)
})
test('the context window is the smallest power of two that holds prompt and reply', () => {
  const text = (n: number) => [{ role: 'user' as const, content: 'x'.repeat(n) }]
  expect(contextWindow(text(100), 16)).toBe(4096)
  expect(contextWindow(text(15_000), 12000)).toBe(32768)
  expect(contextWindow(text(10_000_000), 12000)).toBe(65536)
  expect(isOllama('http://localhost:11434/v1')).toBe(true)
  expect(isOllama('http://localhost:3000/api')).toBe(false)
  expect(isOllama('https://example.com:11434/v1')).toBe(false)
})
test('a local server that is down says what to check', async () => {
  globalThis.fetch = (async () => {
    throw new TypeError('fetch failed')
  }) as typeof fetch
  await expect(
    completion({ endpoint: 'http://localhost:11434/v1', model: 'm', key: '' }, messages, new AbortController().signal)
  ).rejects.toThrow('server on this computer')
})
test('a local server falls back to its first chat model, skipping embedding models', () => {
  expect(suggestModel('http://localhost:11434/v1', ['nomic-embed-text:latest', 'mistral:latest', 'qwen3.5:9b'])).toBe(
    'mistral:latest'
  )
  expect(suggestModel('http://localhost:11434/v1', ['nomic-embed-text:latest'])).toBeUndefined()
  expect(suggestModel('http://localhost:11434/v1', [])).toBeUndefined()
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
test('a new visitor starts on a hosted provider, never on a local one', () => {
  expect(PROVIDERS[0]?.local).toBeUndefined()
  expect(PROVIDERS.filter((p) => p.local).map((p) => p.id)).toEqual(['ollama', 'open-webui'])
})
test('a rejected revision says what was wrong, so a model asked to repair it can fix it', () => {
  const name = (value: unknown) => () => parseSource({ ...example, name: value })
  expect(name('tip-calculator')).toThrow('"tip-calculator" is 14')
  expect(name('tip-calculator')).toThrow('at most 12 characters')
  expect(name('  ')).toThrow('needs a name')
  expect(() => parseSource({ ...example, summary: 'x'.repeat(2001) })).toThrow('summary')
  expect(() => parseSource({ ...example, files: [] })).toThrow('maps file names')
})
