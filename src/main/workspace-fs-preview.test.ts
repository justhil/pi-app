import { afterEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { workspaceFsCreate, workspaceFsListDir, workspaceFsReadText } from './workspace-fs'

const roots: string[] = []
afterEach(() => roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })))
function fixture(content: string) {
  const root = mkdtempSync(join(tmpdir(), 'pi-preview-'))
  roots.push(root)
  writeFileSync(join(root, '中文 动画.html'), content)
  return root
}
describe('workspace text preview', () => {
  it('previews a large file prefix rather than rejecting it', () => {
    const root = fixture('x'.repeat(2 * 1024 * 1024))
    expect(workspaceFsReadText({ workspaceRoot: root, path: '中文 动画.html', maxBytes: 100 })).toMatchObject({
      ok: true, content: 'x'.repeat(100), truncated: true, size: 2 * 1024 * 1024,
    })
  })
  it('can read a complete 2MB file on request', () => {
    const content = 'x'.repeat(2 * 1024 * 1024)
    const root = fixture(content)
    expect(workspaceFsReadText({ workspaceRoot: root, path: '中文 动画.html', maxBytes: 4 * 1024 * 1024 })).toMatchObject({ ok: true, content, truncated: false })
  })
  it('caps oversized requests at 8MB and rejects invalid budgets', () => {
    const limit = 8 * 1024 * 1024
    const root = fixture('x'.repeat(limit + 32))
    const request = { workspaceRoot: root, path: '中文 动画.html' }
    const result = workspaceFsReadText({ ...request, maxBytes: limit * 2 })
    expect(result).toMatchObject({ ok: true, truncated: true })
    expect(result.content?.length).toBe(limit)
    for (const maxBytes of [0, -1, NaN, Infinity]) {
      expect(workspaceFsReadText({ ...request, maxBytes })).toMatchObject({ ok: false, error: 'read_failed' })
    }
  })
  it('never splits a UTF-8 character at the preview boundary', () => {
    const root = fixture('abc中文')
    const result = workspaceFsReadText({ workspaceRoot: root, path: '中文 动画.html', maxBytes: 5 })
    expect(result).toMatchObject({ ok: true, content: 'abc', truncated: true })
  })
  it('preserves Chinese names through listing and preview', () => {
    const root = fixture('中文内容')
    const result = workspaceFsListDir({ workspaceRoot: root })
    expect(result.entries?.[0]).toMatchObject({ name: '中文 动画.html', path: '中文 动画.html' })
    expect(workspaceFsReadText({ workspaceRoot: root, path: result.entries![0].path })).toMatchObject({ ok: true, content: '中文内容' })
  })
  it('keeps binary rejection and workspace traversal protection', () => {
    const root = fixture('abc\0def')
    expect(workspaceFsReadText({ workspaceRoot: root, path: '中文 动画.html' })).toMatchObject({ ok: false, error: 'binary' })
    expect(workspaceFsReadText({ workspaceRoot: root, path: '../secret' })).toMatchObject({ ok: false, error: 'outside_workspace' })
  })
  it('should_reject_create_through_symlink_escape', () => {
    const root = mkdtempSync(join(tmpdir(), 'pi-preview-'))
    roots.push(root)
    const outside = mkdtempSync(join(tmpdir(), 'pi-outside-'))
    roots.push(outside)
    mkdirSync(join(root, 'link-parent'))
    try {
      symlinkSync(outside, join(root, 'link-parent', 'link'), 'dir')
    } catch {
      return
    }
    expect(workspaceFsCreate({
      workspaceRoot: root,
      relativePath: 'link-parent/link/missing/escape.txt',
      isDirectory: false,
    })).toMatchObject({ ok: false, error: 'outside_workspace' })
  })
})
