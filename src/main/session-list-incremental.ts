import { existsSync, readFileSync, writeFileSync } from 'fs'
import { open, readdir, stat } from 'fs/promises'
import { homedir } from 'os'
import { join, resolve } from 'path'

/**
 * Session list for a project without re-reading every transcript.
 *
 * pi's SessionManager.list() streams every .jsonl in the project's session dir on each call (for
 * a busy project: 150 files / 600MB → ~1.6s, plus ~0.9s to import the SDK on a cold preview
 * process). Transcripts are append-only, so keep per-file state keyed by (size, mtime):
 *  - unchanged files are reused as-is;
 *  - grown files only parse the appended bytes;
 *  - everything else is parsed once. State is persisted under userData so a cold start only stats.
 * Row semantics mirror the SDK's buildSessionInfo (header, session_info name, message count,
 * first user text, last user/assistant activity), minus the unused allMessagesText.
 */

const FIRST_MESSAGE_MAX = 4000
const CONCURRENCY = 8
const CACHE_FILE = 'session-list-cache.v1.json'

type FileState = {
  size: number
  mtimeMs: number
  /** Bytes consumed through the last complete line. */
  offset: number
  valid: boolean
  headerSeen: boolean
  id?: string
  cwd?: string
  parentSessionPath?: string
  headerTimestamp?: string
  name?: string
  messageCount: number
  firstMessage: string
  lastActivityTime?: number
}

export type IncrementalSessionRow = {
  path: string
  id: string
  cwd: string
  name?: string
  parentSessionPath?: string
  created: Date
  modified: Date
  messageCount: number
  firstMessage: string
}

let states: Map<string, FileState> | null = null
let cachePath: string | null = null
let saveTimer: ReturnType<typeof setTimeout> | null = null

function loadStates(userDataDir: string | undefined): Map<string, FileState> {
  if (states) return states
  states = new Map()
  if (!userDataDir) return states
  cachePath = join(userDataDir, CACHE_FILE)
  try {
    if (existsSync(cachePath)) {
      const raw = JSON.parse(readFileSync(cachePath, 'utf8')) as Record<string, FileState>
      for (const [path, state] of Object.entries(raw)) states.set(path, state)
    }
  } catch {
    /* corrupt cache: rebuild */
  }
  return states
}

function scheduleSave(): void {
  if (!cachePath || saveTimer) return
  saveTimer = setTimeout(() => {
    saveTimer = null
    try {
      writeFileSync(cachePath!, JSON.stringify(Object.fromEntries(states ?? [])))
    } catch {
      /* read-only / foreign fs (e.g. WSL mount): keep the in-memory cache only */
    }
  }, 500)
  saveTimer.unref?.()
}

function expandTilde(p: string): string {
  const t = p.trim()
  if (t === '~') return homedir()
  if (t.startsWith('~/') || t.startsWith('~\\')) return join(homedir(), t.slice(2))
  return t
}

/** Same derivation as the SDK's getDefaultAgentDir + getDefaultSessionDirPath. */
export function defaultSessionDirFor(cwd: string, agentDir?: string): string {
  const dir = resolve(agentDir ?? (process.env.PI_CODING_AGENT_DIR ? expandTilde(process.env.PI_CODING_AGENT_DIR) : join(homedir(), '.pi', 'agent')))
  const resolvedCwd = resolve(cwd)
  const safe = `--${resolvedCwd.replace(/^[/\\]/, '').replace(/[/\\:]/g, '-')}--`
  return join(dir, 'sessions', safe)
}

type Json = Record<string, unknown>

function textOf(message: Json): string {
  const content = message.content
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .filter((block) => (block as Json)?.type === 'text')
    .map((block) => String((block as Json).text ?? ''))
    .join(' ')
}

function applyLine(state: FileState, line: string): void {
  if (!line.trim()) return
  let entry: Json
  try {
    entry = JSON.parse(line) as Json
  } catch {
    return
  }
  if (!state.headerSeen) {
    state.headerSeen = true
    if (entry.type !== 'session') {
      state.valid = false
      return
    }
    state.valid = true
    state.id = String(entry.id ?? '')
    state.cwd = typeof entry.cwd === 'string' ? entry.cwd : ''
    state.parentSessionPath = typeof entry.parentSession === 'string' ? entry.parentSession : undefined
    state.headerTimestamp = typeof entry.timestamp === 'string' ? entry.timestamp : undefined
    return
  }
  if (!state.valid) return
  if (entry.type === 'session_info') {
    state.name = typeof entry.name === 'string' && entry.name.trim() ? entry.name.trim() : undefined
  }
  if (entry.type !== 'message') return
  state.messageCount++
  const message = entry.message as Json | undefined
  if (!message || typeof message.role !== 'string' || !('content' in message)) return
  if (message.role !== 'user' && message.role !== 'assistant') return
  const activity =
    typeof message.timestamp === 'number' ? message.timestamp : new Date(String(entry.timestamp)).getTime()
  if (!Number.isNaN(activity)) state.lastActivityTime = Math.max(state.lastActivityTime ?? 0, activity)
  if (!state.firstMessage && message.role === 'user') {
    const text = textOf(message)
    if (text) state.firstMessage = text.slice(0, FIRST_MESSAGE_MAX)
  }
}

const NEWLINE = 0x0a

/** Parse complete lines from `state.offset` to EOF; a trailing partial line waits for next time. */
async function consume(path: string, state: FileState, size: number): Promise<void> {
  const handle = await open(path, 'r')
  try {
    const chunkSize = 1 << 20
    let position = state.offset
    let carry: Buffer = Buffer.alloc(0)
    while (position < size) {
      const buffer = Buffer.allocUnsafe(Math.min(chunkSize, size - position))
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, position)
      if (bytesRead <= 0) break
      position += bytesRead
      const data = carry.length ? Buffer.concat([carry, buffer.subarray(0, bytesRead)]) : buffer.subarray(0, bytesRead)
      let start = 0
      for (let i = data.indexOf(NEWLINE); i >= 0; i = data.indexOf(NEWLINE, start)) {
        applyLine(state, data.toString('utf8', start, i))
        state.offset += i + 1 - start
        start = i + 1
        if (state.headerSeen && !state.valid) return
      }
      carry = Buffer.from(data.subarray(start))
    }
  } finally {
    await handle.close()
  }
}

function freshState(): FileState {
  return { size: 0, mtimeMs: 0, offset: 0, valid: false, headerSeen: false, messageCount: 0, firstMessage: '' }
}

async function refreshFile(path: string, known: FileState | undefined): Promise<FileState | null> {
  let info
  try {
    info = await stat(path)
  } catch {
    return null
  }
  if (known && known.size === info.size && known.mtimeMs === info.mtimeMs) return known
  // Append-only transcripts: a grown file only needs its new bytes. Anything else → full parse.
  const state = known && known.valid && info.size > known.size ? { ...known } : freshState()
  await consume(path, state, info.size)
  state.size = info.size
  state.mtimeMs = info.mtimeMs
  return state
}

function toRow(path: string, state: FileState): IncrementalSessionRow | null {
  if (!state.valid || !state.headerTimestamp) return null
  const headerTime = new Date(state.headerTimestamp).getTime()
  const modified =
    state.lastActivityTime && state.lastActivityTime > 0
      ? new Date(state.lastActivityTime)
      : !Number.isNaN(headerTime)
        ? new Date(headerTime)
        : new Date(state.mtimeMs)
  return {
    path,
    id: state.id ?? '',
    cwd: state.cwd ?? '',
    name: state.name,
    parentSessionPath: state.parentSessionPath,
    created: new Date(state.headerTimestamp),
    modified,
    messageCount: state.messageCount,
    firstMessage: state.firstMessage || '(no messages)',
  }
}

/** Returns null when the session dir cannot be derived/found (caller falls back to the SDK). */
export async function listSessionsIncremental(
  cwd: string,
  options?: { userDataDir?: string; agentDir?: string },
): Promise<IncrementalSessionRow[] | null> {
  const dir = defaultSessionDirFor(cwd, options?.agentDir)
  if (!existsSync(dir)) return null
  const cache = loadStates(options?.userDataDir)
  const files = (await readdir(dir)).filter((f) => f.endsWith('.jsonl')).map((f) => join(dir, f))
  const rows: IncrementalSessionRow[] = []
  let changed = false
  let next = 0
  const worker = async () => {
    while (next < files.length) {
      const path = files[next++]
      const known = cache.get(path)
      const state = await refreshFile(path, known)
      if (!state) {
        if (known) {
          cache.delete(path)
          changed = true
        }
        continue
      }
      if (state !== known) {
        cache.set(path, state)
        changed = true
      }
      const row = toRow(path, state)
      if (row) rows.push(row)
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, files.length) }, worker))
  // Forget files deleted from this dir.
  const present = new Set(files)
  for (const path of cache.keys()) {
    if (path.startsWith(dir) && !present.has(path)) {
      cache.delete(path)
      changed = true
    }
  }
  if (changed) scheduleSave()
  rows.sort((a, b) => b.modified.getTime() - a.modified.getTime())
  return rows
}

export function resetIncrementalSessionListForTests(): void {
  states = null
  cachePath = null
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = null
}
