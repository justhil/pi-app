import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const mocks = vi.hoisted(() => ({
  statCalls: [] as string[],
  handlers: new Map<string, (req: Record<string, unknown>) => Promise<unknown>>(),
  afterOpen: null as null | ((path: string) => Promise<void>),
}))

// Main hot paths must not touch the synchronous fs API (UNC paths block the event loop).
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>()
  const blocked = (name: string) => () => {
    throw new Error(`synchronous filesystem access: ${name}`)
  }
  const fs = {
    ...actual,
    existsSync: blocked('existsSync'),
    statSync: blocked('statSync'),
    lstatSync: blocked('lstatSync'),
    openSync: blocked('openSync'),
    readSync: blocked('readSync'),
    readFileSync: blocked('readFileSync'),
    readdirSync: blocked('readdirSync'),
    realpathSync: blocked('realpathSync'),
    mkdirSync: blocked('mkdirSync'),
    writeFileSync: blocked('writeFileSync'),
    renameSync: blocked('renameSync'),
  }
  return { ...fs, default: fs }
})
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  const fs = {
    ...actual,
    stat: (async (path: string, ...rest: unknown[]) => {
      mocks.statCalls.push(String(path))
      return (actual.stat as (...args: unknown[]) => Promise<unknown>)(path, ...rest)
    }) as typeof actual.stat,
    open: (async (...args: Parameters<typeof actual.open>) => {
      const handle = await actual.open(...args)
      if (mocks.afterOpen) await mocks.afterOpen(String(args[0]))
      return handle
    }) as typeof actual.open,
  }
  return { ...fs, default: fs }
})
vi.mock('electron', () => ({ shell: { openPath: vi.fn(), showItemInFolder: vi.fn() } }))
vi.mock('../ipc/registry', () => ({
  registerHandler: (name: string, handler: (req: Record<string, unknown>) => Promise<unknown>) => mocks.handlers.set(name, handler),
  registerHandlerWithSchema: (name: string, schema: { parse: (req: unknown) => Record<string, unknown> }, handler: (req: Record<string, unknown>) => Promise<unknown>) =>
    mocks.handlers.set(name, (req) => handler(schema.parse(req))),
}))
vi.mock('../workspace-file-search', () => ({ workspaceFsSearch: vi.fn() }))

import { readSessionIdFromFile, readSessionMetaFromFile } from '../session-file-meta'
import { resolvePathUnderWorkspace, workspaceFsCreate, workspaceFsListDir, workspaceFsReadText, workspaceFsRename } from '../workspace-fs'
import { registerWorkspaceFsHandlers } from '../ipc/handlers/workspace-fs'

let root: string
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'pi-main-io-'))
  mocks.statCalls.length = 0
  mocks.afterOpen = null
})
afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('R8 session header metadata', () => {
  it('should_read_header_asynchronously_when_sync_fs_is_blocked', async () => {
    const file = join(root, 's.jsonl')
    await writeFile(file, `\n${JSON.stringify({ type: 'session', id: 'id-1', cwd: '/ws' })}\n${'{"x":1}\n'.repeat(5000)}`)
    const pending = readSessionMetaFromFile(file)
    expect(pending).toBeInstanceOf(Promise)
    await expect(pending).resolves.toEqual({ sessionId: 'id-1', cwd: '/ws' })
    await expect(readSessionIdFromFile(file)).resolves.toBe('id-1')
  })

  it('should_return_null_when_header_is_missing_or_corrupt', async () => {
    await writeFile(join(root, 'bad.jsonl'), '{not json\n')
    await writeFile(join(root, 'other.jsonl'), `${JSON.stringify({ type: 'message', id: 'm' })}\n`)
    await writeFile(join(root, 'empty.jsonl'), '')
    await expect(readSessionMetaFromFile(join(root, 'missing.jsonl'))).resolves.toBeNull()
    await expect(readSessionMetaFromFile(join(root, 'bad.jsonl'))).resolves.toBeNull()
    await expect(readSessionMetaFromFile(join(root, 'other.jsonl'))).resolves.toBeNull()
    await expect(readSessionMetaFromFile(join(root, 'empty.jsonl'))).resolves.toBeNull()
  })
})

describe('R8 workspace file operations', () => {
  it('should_resolve_and_reject_paths_asynchronously_when_sync_fs_is_blocked', async () => {
    await mkdir(join(root, 'out'))
    const ws = join(root, 'ws')
    await mkdir(ws)
    await symlink(join(root, 'out'), join(ws, 'escape'), 'dir')
    await expect(resolvePathUnderWorkspace(ws, 'a.txt')).resolves.toMatchObject({ ok: true })
    await expect(resolvePathUnderWorkspace(ws, 'escape/new.txt')).resolves.toEqual({ ok: false, error: 'outside_workspace' })
    await expect(resolvePathUnderWorkspace('', 'a.txt')).resolves.toEqual({ ok: false, error: 'missing_root' })
  })

  it('should_keep_text_preview_contract_when_reading_asynchronously', async () => {
    await writeFile(join(root, 'zh.txt'), '中文内容')
    await writeFile(join(root, 'bin.dat'), Buffer.from([65, 0, 66]))
    await mkdir(join(root, 'dir'))
    // 4 bytes cuts the second CJK character in half: the partial sequence must not be emitted.
    await expect(workspaceFsReadText({ workspaceRoot: root, path: 'zh.txt', maxBytes: 4 })).resolves.toEqual({ ok: true, content: '中', size: 12, truncated: true })
    await expect(workspaceFsReadText({ workspaceRoot: root, path: 'zh.txt' })).resolves.toEqual({ ok: true, content: '中文内容', size: 12, truncated: false })
    await expect(workspaceFsReadText({ workspaceRoot: root, path: 'bin.dat' })).resolves.toEqual({ ok: false, error: 'binary' })
    await expect(workspaceFsReadText({ workspaceRoot: root, path: 'dir' })).resolves.toEqual({ ok: false, error: 'not_a_file' })
    await expect(workspaceFsReadText({ workspaceRoot: root, path: 'nope.txt' })).resolves.toEqual({ ok: false, error: 'not_found' })
    await expect(workspaceFsReadText({ workspaceRoot: root, path: '../x' })).resolves.toEqual({ ok: false, error: 'outside_workspace' })
    await expect(workspaceFsReadText({ workspaceRoot: root, path: 'zh.txt', maxBytes: 0 })).resolves.toEqual({ ok: false, error: 'read_failed' })
  })

  it('should_keep_create_and_rename_contract_when_writing_asynchronously', async () => {
    await expect(workspaceFsCreate({ workspaceRoot: root, relativePath: 'a/b/new.txt' })).resolves.toEqual({ ok: true })
    expect(await readFile(join(root, 'a/b/new.txt'), 'utf8')).toBe('')
    await expect(workspaceFsCreate({ workspaceRoot: root, relativePath: 'a/b/new.txt' })).resolves.toEqual({ ok: false, error: 'target_exists' })
    await expect(workspaceFsCreate({ workspaceRoot: root, relativePath: 'd1/d2', isDirectory: true })).resolves.toEqual({ ok: true })
    await expect(workspaceFsCreate({ workspaceRoot: root, relativePath: '  ' })).resolves.toEqual({ ok: false, error: 'invalid_name' })
    await expect(workspaceFsCreate({ workspaceRoot: root, relativePath: '../escape.txt' })).resolves.toEqual({ ok: false, error: 'outside_workspace' })

    await expect(workspaceFsRename({ workspaceRoot: root, relativePath: 'a/b/new.txt', newName: 'renamed.txt' })).resolves.toEqual({ ok: true, newRelativePath: 'a/b/renamed.txt' })
    await writeFile(join(root, 'a/b/taken.txt'), '')
    await expect(workspaceFsRename({ workspaceRoot: root, relativePath: 'a/b/renamed.txt', newName: 'taken.txt' })).resolves.toEqual({ ok: false, error: 'target_exists' })
    await expect(workspaceFsRename({ workspaceRoot: root, relativePath: 'a/b/missing.txt', newName: 'x.txt' })).resolves.toEqual({ ok: false, error: 'not_found' })
    await expect(workspaceFsRename({ workspaceRoot: root, relativePath: 'a/b/renamed.txt', newName: 'x/y' })).resolves.toEqual({ ok: false, error: 'invalid_name' })
  })
})

describe('R8 image preview IPC', () => {
  async function readImage(path: string) {
    mocks.handlers.clear()
    registerWorkspaceFsHandlers()
    return mocks.handlers.get('ipc:shell.readImagePreview')!({ workspaceRoot: root, path })
  }

  it('should_return_data_url_when_image_is_within_limit', async () => {
    await writeFile(join(root, 'a.png'), Buffer.from([1, 2, 3]))
    await expect(readImage('a.png')).resolves.toEqual({ ok: true, dataUrl: 'data:image/png;base64,AQID', mimeType: 'image/png' })
  })

  it('should_reject_image_when_larger_than_8mb_or_grows_past_limit_while_reading', async () => {
    await writeFile(join(root, 'big.png'), Buffer.alloc(8 * 1024 * 1024 + 1))
    await expect(readImage('big.png')).resolves.toEqual({ ok: false, error: 'too_large' })

    const growing = join(root, 'grow.png')
    await writeFile(growing, Buffer.alloc(16))
    mocks.afterOpen = async (path) => {
      if (path === growing) await writeFile(growing, Buffer.alloc(8 * 1024 * 1024 + 10))
    }
    await expect(readImage('grow.png')).resolves.toEqual({ ok: false, error: 'too_large' })
  })

  it('should_reject_image_outside_workspace_or_missing', async () => {
    await expect(readImage('../x.png')).resolves.toEqual({ ok: false, error: 'outside_workspace' })
    await expect(readImage('missing.png')).resolves.toEqual({ ok: false, error: 'not_found' })
  })
})

describe('R9 bounded directory listing', () => {
  it('should_stat_only_returned_entries_when_directory_exceeds_limit', async () => {
    const dir = join(root, 'big')
    await mkdir(dir)
    await Promise.all(Array.from({ length: 3000 }, (_, index) => writeFile(join(dir, `f${String(index).padStart(4, '0')}.txt`), 'x')))
    await mkdir(join(dir, 'zz-dir'))
    await mkdir(join(dir, 'aa-dir'))
    await writeFile(join(dir, '.hidden'), '')
    mocks.statCalls.length = 0

    const result = await workspaceFsListDir({ workspaceRoot: root, path: 'big' })

    expect(result).toMatchObject({ ok: true, truncated: true, totalCount: 3002 })
    const entries = (result as { entries: Array<{ name: string; isDirectory: boolean; size?: number; mtimeMs?: number }> }).entries
    expect(entries).toHaveLength(2500)
    expect(entries.slice(0, 3).map((entry) => entry.name)).toEqual(['aa-dir', 'zz-dir', 'f0000.txt'])
    expect(entries[2]).toMatchObject({ path: 'big/f0000.txt', isDirectory: false, size: 1 })
    expect(entries[0].size).toBeUndefined()
    expect(typeof entries[0].mtimeMs).toBe('number')
    const childStats = mocks.statCalls.filter((path) => path.startsWith(`${dir}/`) || path.startsWith(`${dir}\\`))
    expect(childStats).toHaveLength(2500)
  })

  it('should_return_all_entries_and_dotfiles_on_request_when_under_limit', async () => {
    await writeFile(join(root, 'b.txt'), '')
    await writeFile(join(root, 'A.txt'), '')
    await writeFile(join(root, '.env'), '')
    await expect(workspaceFsListDir({ workspaceRoot: root })).resolves.toMatchObject({ ok: true, truncated: false, totalCount: 2 })
    const withDot = await workspaceFsListDir({ workspaceRoot: root, includeDotfiles: true })
    expect((withDot as { entries: Array<{ name: string }> }).entries.map((entry) => entry.name)).toEqual(['.env', 'A.txt', 'b.txt'])
    await expect(workspaceFsListDir({ workspaceRoot: root, path: 'b.txt' })).resolves.toMatchObject({ ok: false, error: 'not_found' })
  })
})
