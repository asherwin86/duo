export type Source = { name: string; summary: string; files: Record<string, string> }
export type Message = { id: string; role: 'user' | 'assistant'; content: string }
export type Revision = { id: string; source: Source; at: number }
export type Project = { id: string; name: string; revisions: Revision[]; current: number; messages: Message[] }
export type Runtime = {
  files: Record<string, string>
  css: string
  tokens: Record<string, Record<string, string>>
  sdk: string
  kit: string
  api: unknown
}
export const SOURCE_LIMIT = 180_000
export function parseSource(value: unknown): Source {
  if (!value || typeof value !== 'object') throw new Error('Expected an app object')
  const source = value as Source
  // Each rule says what was wrong: a model asked to repair its answer can only fix what it is told.
  if (typeof source.name !== 'string' || !source.name.trim()) throw new Error('The app needs a name')
  if (source.name.length > 12)
    throw new Error(`The app name must be at most 12 characters, and "${source.name}" is ${source.name.length}`)
  if (typeof source.summary !== 'string' || source.summary.length > 2000)
    throw new Error('The summary must be text of at most 2000 characters')
  if (!source.files || typeof source.files !== 'object' || Array.isArray(source.files))
    throw new Error('files must be an object that maps file names to source text')
  const entries = Object.entries(source.files)
  if (!entries.length || entries.length > 12 || typeof source.files['app.tsx'] !== 'string')
    throw new Error('Include app.tsx and no more than 12 files')
  for (const [path, content] of entries) {
    if (!/^[a-z][a-z0-9-]*(?:\/[a-z][a-z0-9-]*)*\.(?:tsx?|json)$/.test(path) || typeof content !== 'string')
      throw new Error('Only kebab-case TS, TSX and JSON source files are supported')
  }
  if (new TextEncoder().encode(JSON.stringify(source)).length > SOURCE_LIMIT) throw new Error('Source exceeds 180 KB')
  return { name: source.name.trim(), summary: source.summary, files: Object.fromEntries(entries) }
}
export function parseResponse(text: string) {
  const clean = text
    .trim()
    .replace(/^```(?:json)?\s*\n/, '')
    .replace(/\n```$/, '')
  try {
    return parseSource(JSON.parse(clean))
  } catch (error) {
    throw new Error(`Invalid generated revision: ${error instanceof Error ? error.message : 'invalid JSON'}`)
  }
}
