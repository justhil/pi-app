import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it, vi } from 'vitest'
import {
  buildWorkspaceFileSearchQuery,
  clearWorkspaceFileSearchCaches,
  rankWorkspaceFileSearchEntries,
  resolveFdExecutable,
  workspaceFsSearch,
} from './workspace-file-search'

vi.mock('./config-store', () => ({
  configStore: {
    get: vi.fn(() => undefined),
  },
}))

describe('workspace file search query and ranking', () => {
  it('normalizes slash scopes and rejects traversal outside the workspace', () => {
    const root = mkdtempSync(join(tmpdir(), 'pi-file-search-'))
    mkdirSync(join(root, 'src', 'components'), { recursive: true })

    expect(buildWorkspaceFileSearchQuery(root, 'src\\components\\cmp')).toMatchObject({
      ok: true,
      scopePrefix: 'src/components/',
      query: 'cmp',
    })
    expect(buildWorkspaceFileSearchQuery(root, '../outside')).toEqual({
      ok: false,
      error: 'outside_workspace',
    })
  })

  it('orders exact filename, prefix, filename substring, then path substring with directory bonus', () => {
    const ranked = rankWorkspaceFileSearchEntries(
      [
        { path: 'docs/cmp-guide.md', name: 'cmp-guide.md', isDirectory: false },
        { path: 'src/mycmp.ts', name: 'mycmp.ts', isDirectory: false },
        { path: 'src/cmp', name: 'cmp', isDirectory: true },
        { path: 'cmp', name: 'cmp', isDirectory: false },
        { path: 'src/cmp-helper.ts', name: 'cmp-helper.ts', isDirectory: false },
        { path: 'cmp-folder/other.ts', name: 'other.ts', isDirectory: false },
      ],
      'cmp',
      20,
    )

    expect(ranked.map((entry) => entry.path)).toEqual([
      'src/cmp',
      'cmp',
      'docs/cmp-guide.md',
      'src/cmp-helper.ts',
      'src/mycmp.ts',
      'cmp-folder/other.ts',
    ])
  })
})

const availableFd = await resolveFdExecutable()

describe('workspace fd search adapter', () => {
  it('resolves the configured pi-managed fd executable without downloading', async () => {
    const agentDir = mkdtempSync(join(tmpdir(), 'pi-agent-dir-'))
    const binDir = join(agentDir, 'bin')
    mkdirSync(binDir, { recursive: true })
    const managed = join(binDir, process.platform === 'win32' ? 'fd.exe' : 'fd')
    writeFileSync(managed, '')
    const previous = process.env.PI_CODING_AGENT_DIR
    process.env.PI_CODING_AGENT_DIR = agentDir
    clearWorkspaceFileSearchCaches()
    try {
      expect(await resolveFdExecutable()).toBe(managed)
    } finally {
      if (previous == null) delete process.env.PI_CODING_AGENT_DIR
      else process.env.PI_CODING_AGENT_DIR = previous
      clearWorkspaceFileSearchCaches()
    }
  })

  it.skipIf(!availableFd)('respects gitignore, includes hidden files, excludes .git, follows symlinks, normalizes paths, and caps results', async () => {
    const root = mkdtempSync(join(tmpdir(), 'pi-file-search-'))
    mkdirSync(join(root, '.git'), { recursive: true })
    mkdirSync(join(root, 'src'), { recursive: true })
    mkdirSync(join(root, 'ignored'), { recursive: true })
    mkdirSync(join(root, 'real-dir'), { recursive: true })
    writeFileSync(join(root, '.gitignore'), 'ignored/\n')
    writeFileSync(join(root, '.hidden-file'), 'hidden')
    writeFileSync(join(root, '.git', 'config'), 'git')
    writeFileSync(join(root, 'ignored', 'ignored.ts'), 'ignored')
    writeFileSync(join(root, 'real-dir', 'linked.ts'), 'linked')
    for (let i = 0; i < 25; i += 1) writeFileSync(join(root, 'src', `file-${i}.ts`), String(i))

    let symlinkCreated = false
    try {
      symlinkSync(join(root, 'real-dir'), join(root, 'linked-dir'), 'junction')
      symlinkCreated = existsSync(join(root, 'linked-dir', 'linked.ts'))
    } catch {
      symlinkCreated = false
    }

    const result = await workspaceFsSearch({ workspaceRoot: root, query: '', maxResults: 20 })
    const hidden = await workspaceFsSearch({ workspaceRoot: root, query: '.hidden-file', maxResults: 20 })
    const ignored = await workspaceFsSearch({ workspaceRoot: root, query: 'ignored', maxResults: 20 })
    const git = await workspaceFsSearch({ workspaceRoot: root, query: 'config', maxResults: 20 })
    const linked = await workspaceFsSearch({ workspaceRoot: root, query: 'linked', maxResults: 20 })

    expect(result.ok).toBe(true)
    expect(result.entries).toHaveLength(20)
    expect(hidden.entries.some((entry) => entry.path === '.hidden-file')).toBe(true)
    expect(git.entries.every((entry) => !entry.path.startsWith('.git/'))).toBe(true)
    expect(ignored.entries.every((entry) => !entry.path.startsWith('ignored/'))).toBe(true)
    expect(result.entries.every((entry) => !entry.path.includes('\\'))).toBe(true)
    if (symlinkCreated) {
      expect(linked.entries.some((entry) => entry.path === 'linked-dir/linked.ts')).toBe(true)
    }
  })
})
