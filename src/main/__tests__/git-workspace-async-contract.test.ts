import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const read = (file: string) => readFileSync(join(root, file), 'utf8')

describe('read-only git snapshot owner', () => {
  it('uses async execFile for snapshots and ordered hunk mutations', () => {
    const source = read('src/main/git-workspace.ts')
    const handler = read('src/main/ipc/handlers/review.ts')

    expect(source).toContain('async function gitExec(')
    expect(source).toContain("execFile('git', args")
    expect(source).toContain('export async function readGitWorkspaceSnapshot')
    expect(source).toContain("await gitExec(cwd, ['apply'")
    expect(source).not.toContain("gitExecSync(cwd, ['apply'")
    expect(source).toContain('withIndexWriteLock(cwd')
    expect(handler).toContain('await readGitWorkspaceSnapshot(cwd)')
    expect(handler).toContain('await stageHunks(')
    expect(handler).toContain('await unstageHunks(')
  })
})
