import { afterEach, expect, it, vi } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readGitWorkspaceSnapshot } from './git-workspace'
import { parseGitDiff } from '../../packages/shared/diff-model'
vi.mock('./wsl/runtime-config', () => ({ getAgentRuntimeConfig: () => ({ mode: 'native' }) }))
let root: string | undefined
afterEach(() => { if (root) rmSync(root, { recursive: true, force: true }) })
it('reads real Git quoted Chinese paths and their untracked file content', async () => {
  root = mkdtempSync(join(tmpdir(), 'pi-git-preview-'))
  execFileSync('git', ['init', '-q', root])
  execFileSync('git', ['config', 'core.quotePath', 'true'], { cwd: root })
  writeFileSync(join(root, '中文 动画.html'), '<p>中文内容</p>')
  const snapshot = await readGitWorkspaceSnapshot(root)
  expect(snapshot.isRepo).toBe(true)
  expect(snapshot.status).toContain('\\344')
  const file = parseGitDiff(snapshot.raw)[0]
  expect(file.path).toBe('中文 动画.html')
  expect(file.hunks[0].lines.map(line => line.content).join('\n')).toContain('中文内容')
})
