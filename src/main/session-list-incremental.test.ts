import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SessionManager } from '@earendil-works/pi-coding-agent'
import {
  defaultSessionDirFor,
  listSessionsIncremental,
  resetIncrementalSessionListForTests,
} from './session-list-incremental'

let root: string
let agentDir: string
let userDataDir: string
const cwd = '/work/project'

const line = (entry: Record<string, unknown>) => JSON.stringify(entry) + '\n'
const header = (id: string, ts: string) => line({ type: 'session', version: 3, id, timestamp: ts, cwd })
const message = (role: string, text: string, ts: number) =>
  line({ type: 'message', id: `m${ts}`, parentId: null, timestamp: new Date(ts).toISOString(), message: { role, content: [{ type: 'text', text }], timestamp: ts } })

function sessionDir(): string {
  const dir = defaultSessionDirFor(cwd, agentDir)
  mkdirSync(dir, { recursive: true })
  return dir
}

const comparable = (rows: Array<Record<string, unknown>>) =>
  rows.map((r) => ({
    path: r.path,
    id: r.id,
    name: r.name,
    messageCount: r.messageCount,
    firstMessage: r.firstMessage,
    created: +(r.created as Date),
    modified: +(r.modified as Date),
  }))

beforeEach(() => {
  resetIncrementalSessionListForTests()
  root = mkdtempSync(join(tmpdir(), 'pi-session-list-'))
  agentDir = join(root, 'agent')
  userDataDir = join(root, 'userData')
  mkdirSync(userDataDir, { recursive: true })
})

afterEach(() => {
  resetIncrementalSessionListForTests()
  rmSync(root, { recursive: true, force: true })
})

describe('listSessionsIncremental', () => {
  it('matches SessionManager.list, then follows appends and renames incrementally', async () => {
    const dir = sessionDir()
    const a = join(dir, 'a.jsonl')
    const b = join(dir, 'b.jsonl')
    writeFileSync(a, header('a', '2026-01-01T00:00:00.000Z') + message('user', 'first A', 1000) + message('assistant', 'ok', 2000))
    writeFileSync(b, header('b', '2026-01-02T00:00:00.000Z') + message('user', 'first B', 5000))
    writeFileSync(join(dir, 'broken.jsonl'), line({ type: 'message' }))

    const expectSame = async () => {
      const mine = await listSessionsIncremental(cwd, { agentDir, userDataDir })
      const ref = await SessionManager.list(cwd, dir)
      expect(comparable(mine as never)).toEqual(comparable(ref as never))
    }
    await expectSame()

    // Grow A past B (append-only path) and rename it.
    appendFileSync(a, message('user', 'more', 9000) + line({ type: 'session_info', id: 'n1', timestamp: new Date(9001).toISOString(), name: 'Renamed' }))
    await expectSame()
    const rows = await listSessionsIncremental(cwd, { agentDir, userDataDir })
    expect(rows?.[0]).toMatchObject({ id: 'a', name: 'Renamed', messageCount: 3, firstMessage: 'first A' })

    // A deleted file disappears.
    rmSync(b)
    await expectSame()
  })

  it('leaves a trailing partial line for the next call and survives a cold restart from the persisted cache', async () => {
    const dir = sessionDir()
    const a = join(dir, 'a.jsonl')
    const partial = message('user', 'late', 4000)
    writeFileSync(a, header('a', '2026-01-01T00:00:00.000Z') + message('user', 'hello', 1000) + partial.slice(0, 20))
    expect((await listSessionsIncremental(cwd, { agentDir, userDataDir }))?.[0].messageCount).toBe(1)

    appendFileSync(a, partial.slice(20))
    expect((await listSessionsIncremental(cwd, { agentDir, userDataDir }))?.[0]).toMatchObject({ messageCount: 2 })

    await new Promise((resolve) => setTimeout(resolve, 600)) // debounced cache write
    resetIncrementalSessionListForTests()
    const restored = await listSessionsIncremental(cwd, { agentDir, userDataDir })
    expect(restored?.[0]).toMatchObject({ id: 'a', messageCount: 2, firstMessage: 'hello' })
  })

  it('returns null when the project has no session dir (caller falls back to the SDK)', async () => {
    expect(await listSessionsIncremental('/no/such/project', { agentDir, userDataDir })).toBeNull()
  })
})
