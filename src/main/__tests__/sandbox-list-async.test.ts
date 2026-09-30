import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const mocks = vi.hoisted(() => ({ root: '' }))
vi.mock('electron', () => ({ app: { getPath: () => mocks.root } }))
vi.mock('../wsl/runtime-config', () => ({ isWslRuntimeActive: () => true }))
vi.mock('../agent-dir', () => ({ resolveActiveDesktopDir: () => mocks.root }))
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>()
  const blocked = () => { throw new Error('synchronous sandbox list filesystem access') }
  const fs = { ...actual, existsSync: blocked, mkdirSync: blocked, readFileSync: blocked, readdirSync: blocked, writeFileSync: blocked }
  return { ...fs, default: fs }
})

import * as sandbox from '../sandbox-workspaces'

afterEach(async () => { if (mocks.root) await rm(mocks.root, { recursive: true, force: true }) })

describe('asynchronous sandbox list', () => {
  it('should_list_and_bind_asynchronously_when_sandbox_metadata_is_on_wsl', async () => {
    mocks.root = await mkdtemp(join(tmpdir(), 'sandbox-async-'))
    const root = join(mocks.root, 'sandbox-workspaces')
    for (const [id, createdAt] of [['older', 1], ['newer', 2]] as const) {
      const dir = join(root, id)
      await mkdir(dir, { recursive: true })
      await writeFile(join(dir, '.pi-desktop-sandbox.json'), JSON.stringify({ id, label: id, createdAt, kind: 'sandbox' }))
    }
    await mkdir(join(root, 'broken'))
    await writeFile(join(root, 'broken', '.pi-desktop-sandbox.json'), '{')
    const pending = sandbox.listSandboxWorkspaces()
    expect(pending).toBeInstanceOf(Promise)
    const list = await pending
    expect(list.map((entry) => entry.id)).toEqual(['newer', 'older'])
    const bind = Reflect.get(sandbox, 'bindSandboxSessionAsync') as (path: string, id: string, file: string) => Promise<boolean>
    await expect(bind(list[0].path, 'session', '/home/u/s.jsonl')).resolves.toBe(true)
    expect(JSON.parse(await readFile(join(list[0].path, '.pi-desktop-sandbox.json'), 'utf8'))).toMatchObject({ sessionId: 'session', sessionFile: '/home/u/s.jsonl' })
  })
})
