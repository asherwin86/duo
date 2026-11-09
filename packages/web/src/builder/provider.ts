export type Connection = { endpoint: string; model: string; key: string }
export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string }
export type Provider = {
  id: string
  name: string
  endpoint: string
  model: string
  keys: string
  /** Runs on the person's own computer: plain http on loopback is allowed and the key is optional. */
  local?: boolean
  /** What the key field is for, when the server is local and may not need one. */
  keyHint?: string
}
/** OpenAI-compatible endpoints known to allow browser requests. Anything else is a custom endpoint. */
export const PROVIDERS: Provider[] = [
  // The first entry is what a new visitor starts on, so it stays a hosted one: a local preset would make every
  // visitor's browser knock on their own port 11434 before they asked for it.
  {
    id: 'openrouter',
    name: 'OpenRouter',
    endpoint: 'https://openrouter.ai/api/v1',
    model: 'openrouter/auto',
    keys: 'https://openrouter.ai/keys'
  },
  {
    id: 'openai',
    name: 'OpenAI',
    endpoint: 'https://api.openai.com/v1',
    model: 'gpt-5',
    keys: 'https://platform.openai.com/api-keys'
  },
  {
    id: 'google',
    name: 'Google Gemini',
    endpoint: 'https://generativelanguage.googleapis.com/v1beta/openai',
    model: 'gemini-flash-latest',
    keys: 'https://aistudio.google.com/apikey'
  },
  {
    id: 'groq',
    name: 'Groq',
    endpoint: 'https://api.groq.com/openai/v1',
    model: 'openai/gpt-oss-120b',
    keys: 'https://console.groq.com/keys'
  },
  {
    id: 'ollama',
    name: 'Ollama (this computer)',
    endpoint: 'http://localhost:11434/v1',
    model: '',
    keys: 'https://ollama.com/download',
    local: true,
    keyHint: 'Not needed for Ollama'
  },
  {
    id: 'open-webui',
    name: 'Open WebUI (this computer)',
    endpoint: 'http://localhost:3000/api',
    model: '',
    keys: 'http://localhost:3000',
    local: true,
    keyHint: 'Open WebUI key: Settings, Account, API keys'
  }
]
/** Model IDs the endpoint lists; OpenRouter answers without a key, the others need one. */
export async function models(connection: Connection, signal: AbortSignal): Promise<string[]> {
  const url = endpointURL(connection.endpoint).replace(/chat\/completions$/, 'models')
  const key = connection.key.trim()
  const response = await fetch(url, {
    headers: key ? { Authorization: `Bearer ${key}` } : {},
    credentials: 'omit',
    redirect: 'error',
    referrerPolicy: 'no-referrer',
    signal
  })
  if (!response.ok) throw new Error(`Model list unavailable (${response.status})`)
  const data = await response.json()
  const list: unknown[] = Array.isArray(data?.data) ? data.data : []
  return list
    .map((m) =>
      m && typeof m === 'object' && typeof (m as { id?: unknown }).id === 'string' ? (m as { id: string }).id : ''
    )
    .filter(Boolean)
    .map((id) => id.replace(/^models\//, ''))
    .sort()
}
/** A server on this computer: the only place plain http is accepted, since nothing crosses a network. */
export function isLoopback(base: string) {
  try {
    const { hostname } = new URL(base.trim())
    return (
      hostname === 'localhost' || hostname.endsWith('.localhost') || hostname === '127.0.0.1' || hostname === '[::1]'
    )
  } catch {
    return false
  }
}
/**
 * A model to use when the one selected is not on the list the key was given. Gemini is guessed
 * for because its names turn over every few months: the alias or the newest plain Flash is a safe
 * stand-in. A local server lists only what is installed, so its first chat model will do.
 * Anything else is the person's choice, so there is no answer.
 */
export function suggestModel(endpoint: string, list: string[]) {
  if (isLoopback(endpoint)) return list.find((id) => !/embed|rerank/i.test(id))
  if (!endpoint.includes('generativelanguage.googleapis.com')) return undefined
  if (list.includes('gemini-flash-latest')) return 'gemini-flash-latest'
  return list
    .filter((id) => /^gemini-[\d.]+-flash$/.test(id))
    .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))[0]
}
/**
 * Ollama on its own port. Its OpenAI-style /v1 route cannot be told how much of a prompt to keep, and a
 * builder prompt is about 5,000 tokens against Ollama's default window of 4,096: the start of it, which
 * holds every instruction, would be silently dropped. Its own /api/chat takes the window per request.
 */
export function isOllama(base: string) {
  try {
    return isLoopback(base) && new URL(base.trim()).port === '11434'
  } catch {
    return false
  }
}
/** The smallest window, in powers of two from 4,096, that holds the prompt and the longest reply asked for. */
export function contextWindow(messages: ChatMessage[], reply: number) {
  // Code runs about three characters to a token, so this errs on the large side.
  const needed = Math.ceil(messages.reduce((n, m) => n + m.content.length, 0) / 3) + reply
  let window = 4096
  while (window < needed && window < 65536) window *= 2
  return window
}
export function endpointURL(base: string) {
  const url = new URL(base.trim())
  const secure = url.protocol === 'https:' || (url.protocol === 'http:' && isLoopback(base))
  if (!secure || url.username || url.password || url.search || url.hash)
    throw new Error(
      'Use an HTTPS API base URL (http only for localhost) without credentials, query parameters or a fragment'
    )
  url.pathname = `${url.pathname.replace(/\/+$/, '')}/chat/completions`
  return url.href
}
/** The most a local model's memory can hold of prompt and reply together, in characters at about three to a token. */
export const LOCAL_MEMORY = 60_000 * 3
/**
 * A reply from a model on this computer runs until the model says it is done. It is not capped, nothing times
 * it out (the Stop button is the only other end), and a reply the server cut off at the edge of its memory is
 * carried on from where it stopped, since the cost is only time. A hosted provider is paid by the token, so
 * its reply keeps the cap and the timeout.
 */
export async function completion(
  connection: Connection,
  messages: ChatMessage[],
  signal: AbortSignal,
  progress: (characters: number) => void = () => {},
  test = false
) {
  if (test || !isLoopback(connection.endpoint))
    return (await request(connection, messages, signal, progress, test)).text
  let output = ''
  while (true) {
    // The part so far goes back as the start of the model's own answer, so it picks up mid-sentence.
    const round = output ? [...messages, { role: 'assistant' as const, content: output }] : messages
    const part = await request(connection, round, signal, (n) => progress(output.length + n), test)
    // A round that was cut off yet added nothing would be asked again forever.
    if (part.cut && !part.text) throw new Error('The model stopped without finishing. Try again or pick another model.')
    output += part.text
    if (!part.cut) return output
    if (output.length > LOCAL_MEMORY / 2)
      throw new Error('The reply is longer than the model can keep in memory. Ask for a smaller app.')
  }
}
async function request(
  connection: Connection,
  messages: ChatMessage[],
  signal: AbortSignal,
  progress: (characters: number) => void,
  test: boolean
) {
  const checked = endpointURL(connection.endpoint)
  const local = isLoopback(connection.endpoint)
  const native = isOllama(connection.endpoint)
  const url = native ? new URL('/api/chat', checked).href : checked
  if (!connection.key.trim() && !local) throw new Error('Enter your API key in Connection')
  if (!connection.model.trim()) throw new Error('Enter a model ID in Connection')
  // Past this the server drops the start of the prompt, which holds the instructions, and answers anyway.
  if (local && messages.reduce((n, m) => n + m.content.length, 0) > LOCAL_MEMORY)
    throw new Error('This is more than the model can keep in memory at once. Start a new app or ask for less.')
  // Only a hosted provider is cut off by time: a model on this computer can take as long as it needs.
  const limit = 180_000
  const combined = local ? signal : AbortSignal.any([signal, AbortSignal.timeout(limit)])
  // OpenAI's newer models take only `max_completion_tokens`; everyone else still reads `max_tokens`.
  let param: 'max_tokens' | 'max_completion_tokens' =
    new URL(url).hostname === 'api.openai.com' ? 'max_completion_tokens' : 'max_tokens'
  // What the window is sized for, and the cap sent. A local reply is open-ended: it ends when the model does.
  const reply = test ? 16 : 12000
  const open = local && !test
  const send = () =>
    fetch(url, {
      method: 'POST',
      credentials: 'omit',
      redirect: 'error',
      referrerPolicy: 'no-referrer',
      headers: {
        ...(connection.key.trim() ? { Authorization: `Bearer ${connection.key.trim()}` } : {}),
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(
        native
          ? {
              model: connection.model.trim(),
              messages,
              stream: true,
              // Thinking first would spend minutes of a small card's time before the first line of code.
              think: false,
              options: { num_ctx: contextWindow(messages, reply), num_predict: open ? -1 : reply }
            }
          : {
              model: connection.model.trim(),
              messages,
              stream: true,
              ...(open ? {} : { [param]: reply }),
              // Open WebUI hands this on to Ollama; other local servers ignore it.
              ...(local ? { options: { num_ctx: contextWindow(messages, reply) } } : {})
            }
      ),
      signal: combined
    })
  let response: Response
  try {
    response = await send()
    // A 400 that names the token limit means this provider wants the other spelling: ask once more.
    // The body is only searched for the parameter's name; it is never shown or kept.
    if (response.status === 400) {
      const detail = (await response.text()).slice(0, 4000)
      const other = param === 'max_tokens' ? 'max_completion_tokens' : 'max_tokens'
      if (detail.includes(other) || detail.includes(param)) {
        param = other
        response = await send()
      }
    }
  } catch {
    if (combined.aborted)
      throw new Error(signal.aborted ? 'Stopped' : `Provider timed out after ${Math.round(limit / 60_000)} minutes`)
    // A server that dropped the stream partway is not the same as one that never answered.
    throw new Error(
      local
        ? 'Cannot reach the server on this computer. Check that it is running and published on that port, and that it allows this site (for Ollama, OLLAMA_ORIGINS).'
        : 'Cannot reach this endpoint. Check the URL, connection and provider browser CORS support.'
    )
  }
  if (!response.ok) {
    void response.body?.cancel().catch(() => {})
    const reason: Record<number, string> = {
      400: 'Provider rejected the request (400). Check the model ID and that it supports chat completions.',
      404: 'Provider could not find that model or address (404). Pick a model from the Model list in Connection.',
      401: 'API key was rejected',
      403: 'Access denied by the provider',
      402: 'Provider credits are exhausted',
      429: 'Provider rate limit reached; retry later'
    }
    throw new Error(reason[response.status] ?? `Provider request failed (${response.status})`)
  }
  if (!response.body) throw new Error('Provider returned an empty response')
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  const streaming = native || response.headers.get('content-type')?.includes('text/event-stream')
  let buffer = '',
    output = '',
    received = 0,
    complete = false,
    cut = false
  function consume(json: string) {
    if (json === '[DONE]') {
      complete = true
      return
    }
    let data = JSON.parse(json)
    // Ollama's own stream, one JSON object a line, is read as the OpenAI chunk it stands for.
    if (native && !data.error)
      data = {
        choices: [
          {
            delta: { content: data.message?.content },
            finish_reason: data.done ? (data.done_reason === 'length' ? 'length' : 'stop') : null
          }
        ]
      }
    if (data.error) throw new Error('Provider reported a generation error')
    const choice = data.choices?.[0]
    // The connection test caps the reply at a few tokens, so stopping there is the expected end,
    // not a cut-off app. A generated revision that hits the cap is still refused.
    if (choice?.finish_reason === 'length') {
      if (!test && !open) throw new Error('Response was truncated. Ask for a smaller app.')
      // An open-ended local reply that was cut off is not finished: `completion` carries it on.
      cut = open
      complete = true
    }
    if (choice?.finish_reason === 'content_filter') throw new Error('Provider declined this request')
    const content = choice?.delta?.content ?? choice?.message?.content
    if (typeof content === 'string') {
      output += content
      progress(output.length)
    }
    if (choice?.finish_reason === 'stop') complete = true
  }
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      received += value.byteLength
      if (received > 2_000_000) throw new Error('Provider response exceeds the size limit')
      buffer += decoder.decode(value, { stream: true }).replace(/\r/g, '')
      if (streaming) {
        const gap = native ? '\n' : '\n\n'
        let index = buffer.indexOf(gap)
        while (index !== -1) {
          const event = buffer.slice(0, index)
          buffer = buffer.slice(index + gap.length)
          const data = native
            ? event.trim()
            : event
                .split('\n')
                .filter((line) => line.startsWith('data:'))
                .map((line) => line.slice(5).trimStart())
                .join('\n')
          if (data) consume(data)
          index = buffer.indexOf(gap)
        }
      }
    }
    buffer += decoder.decode()
    if (native && buffer.trim()) consume(buffer.trim())
    else if (!streaming) consume(buffer)
    // A model that reasons first can spend the whole test cap before saying anything; it answered, which is the test.
    if (!complete || (!test && !output.trim() && !cut))
      throw new Error('Provider stream ended before a complete response')
    return { text: output, cut }
  } finally {
    await reader.cancel().catch(() => {})
  }
}
