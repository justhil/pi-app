import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

const roots: string[] = []
afterEach(() => {
  vi.doUnmock('path')
  vi.resetModules()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

async function loadWithWin32Paths() {
  vi.resetModules()
  vi.doMock('path', async (original) => {
    const actual = await original<typeof import('path')>()
    return { ...actual.win32, default: actual.win32 }
  })
  return import('./workspace-fs')
}

describe('R3 Windows workspace containment (path.win32 semantics)', () => {
  it('should_reject_path_when_it_is_on_a_different_drive', async () => {
    const { resolvePathUnderWorkspace } = await loadWithWin32Paths()
    await expect(Promise.resolve(resolvePathUnderWorkspace('D:\\workspace', 'C:\\private\\secret.txt'))).resolves.toEqual({ ok: false, error: 'outside_workspace' })
  })

  it('should_reject_path_when_parent_traversal_leaves_the_drive_root_workspace', async () => {
    const { resolvePathUnderWorkspace } = await loadWithWin32Paths()
    await expect(Promise.resolve(resolvePathUnderWorkspace('D:\\workspace\\app', '..\\other\\x.txt'))).resolves.toEqual({ ok: false, error: 'outside_workspace' })
  })

  it('should_allow_relative_and_same_drive_paths_when_inside_workspace', async () => {
    const { resolvePathUnderWorkspace } = await loadWithWin32Paths()
    await expect(Promise.resolve(resolvePathUnderWorkspace('D:\\workspace', 'src\\a.ts'))).resolves.toEqual({ ok: true, abs: 'D:\\workspace\\src\\a.ts' })
    await expect(Promise.resolve(resolvePathUnderWorkspace('D:\\workspace', 'd:\\workspace\\src\\a.ts'))).resolves.toMatchObject({ ok: true })
    await expect(Promise.resolve(resolvePathUnderWorkspace('D:\\workspace', '..workspace-notes.txt'))).resolves.toMatchObject({ ok: true })
  })

  it('should_allow_wsl_unc_path_when_inside_unc_workspace', async () => {
    const { resolvePathUnderWorkspace } = await loadWithWin32Paths()
    const root = '\\\\wsl.localhost\\Ubuntu\\home\\me\\proj'
    await expect(Promise.resolve(resolvePathUnderWorkspace(root, 'src/a.ts'))).resolves.toEqual({ ok: true, abs: `${root}\\src\\a.ts` })
    await expect(Promise.resolve(resolvePathUnderWorkspace(root, 'C:\\Users\\me\\secret'))).resolves.toEqual({ ok: false, error: 'outside_workspace' })
    await expect(Promise.resolve(resolvePathUnderWorkspace(root, '\\\\wsl.localhost\\Debian\\etc\\passwd'))).resolves.toEqual({ ok: false, error: 'outside_workspace' })
  })
})

describe('R3 symlink containment (real file system)', () => {
  function fixture() {
    const base = mkdtempSync(join(tmpdir(), 'pi-ws-boundary-'))
    roots.push(base)
    const root = join(base, 'root')
    const outside = join(base, 'outside')
    mkdirSync(root)
    mkdirSync(outside)
    writeFileSync(join(outside, 'secret.txt'), 'secret')
    writeFileSync(join(root, 'inside.txt'), 'inside')
    symlinkSync(outside, join(root, 'link'), 'dir')
    return { root }
  }

  it('should_reject_existing_file_when_reached_through_escaping_symlink', async () => {
    const { resolvePathUnderWorkspace } = await import('./workspace-fs')
    const { root } = fixture()
    await expect(Promise.resolve(resolvePathUnderWorkspace(root, 'link/secret.txt'))).resolves.toEqual({ ok: false, error: 'outside_workspace' })
  })

  it('should_reject_missing_file_when_parent_is_escaping_symlink', async () => {
    const { resolvePathUnderWorkspace } = await import('./workspace-fs')
    const { root } = fixture()
    await expect(Promise.resolve(resolvePathUnderWorkspace(root, 'link/new/file.txt'))).resolves.toEqual({ ok: false, error: 'outside_workspace' })
  })

  it('should_allow_file_when_inside_real_root', async () => {
    const { resolvePathUnderWorkspace } = await import('./workspace-fs')
    const { root } = fixture()
    await expect(Promise.resolve(resolvePathUnderWorkspace(root, 'inside.txt'))).resolves.toMatchObject({ ok: true })
  })
})
