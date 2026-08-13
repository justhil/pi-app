import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AppEvent, TurnDiffFile } from '@shared/app-events'
import {
  captureTurnFileBaseline,
  configureTurnDiffSnapshotBytes,
  finalizeTurnDiff,
  isBinaryBuffer,
  normalizeFileKey,
  pickToolPath,
  resetTurnDiffState,
  turnDiffSnapshotBytes,
} from './turn-file-diff'

let dir = ''
let workspace = ''
let emitted: AppEvent[] = []

function opts(overrides: Partial<Parameters<typeof captureTurnFileBaseline>[2]> = {}) {
  return {
    turnId: 'turn-1',
    runId: 'run-1',
    cwd: workspace,
    base: {
      seq: 1,
      workspaceId: workspace,
      sessionId: 's1',
      sessionFile: join(workspace, 's.jsonl'),
      runId: 'run-1',
      turnId: 'turn-1',
      timestamp: 1,
    },
    emit: (e: AppEvent) => emitted.push(e),
    ...overrides,
  }
}

function path(name: string): string {
  return join(workspace, name)
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'pi-turn-diff-'))
  workspace = join(dir, 'ws')
  mkdirSync(workspace, { recursive: true })
  emitted = []
  resetTurnDiffState()
  configureTurnDiffSnapshotBytes(1024 * 1024)
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('turn-file-diff helpers', () => {
  it('picks path only from mutate tools', () => {
    expect(pickToolPath('edit', { path: '/a.ts' })).toBe('/a.ts')
    expect(pickToolPath('write', { file: '/b.ts' })).toBe('/b.ts')
    expect(pickToolPath('insert', { filePath: '/c.ts' })).toBe('/c.ts')
    expect(pickToolPath('bash', { path: '/x.sh' })).toBeNull()
    expect(pickToolPath('read', { path: '/x.ts' })).toBeNull()
    expect(pickToolPath('edit', {})).toBeNull()
  })

  it('detects binary buffers', () => {
    expect(isBinaryBuffer(Buffer.from('plain text'))).toBe(false)
    expect(isBinaryBuffer(Buffer.from('a\0b'))).toBe(true)
  })

  it('normalizes file keys case/separator-insensitively', () => {
    expect(normalizeFileKey('C:\\Src\\A.ts')).toBe(normalizeFileKey('c:/src/a.ts'))
  })

  it('configure clamps and accepts 0 = off', () => {
    configureTurnDiffSnapshotBytes(999999999)
    expect(turnDiffSnapshotBytes()).toBe(16 * 1024 * 1024)
    configureTurnDiffSnapshotBytes(0)
    expect(turnDiffSnapshotBytes()).toBe(0)
  })
})

describe('turn-file-diff capture + finalize', () => {
  it('generates a full-add diff for a new file', async () => {
    await captureTurnFileBaseline('write', { path: path('new.ts') }, opts())
    writeFileSync(path('new.ts'), 'hello\nworld\n')
    await finalizeTurnDiff()

    expect(emitted).toHaveLength(1)
    const files = (emitted[0] as { files: TurnDiffFile[] }).files
    expect(files).toHaveLength(1)
    expect(files[0].status).toBe('added')
    expect(files[0].additions).toBe(2)
    expect(files[0].diffText).toContain('+hello')
    expect(files[0].diffText).toContain('+world')
  })

  it('generates a modified diff against the first-capture baseline', async () => {
    writeFileSync(path('a.ts'), 'one\ntwo\nthree\n')
    await captureTurnFileBaseline('edit', { path: path('a.ts') }, opts())
    // 中间多次修改（第二次修改不应重置基线）
    writeFileSync(path('a.ts'), 'one\nTWO\nthree\n')
    await captureTurnFileBaseline('edit', { path: path('a.ts') }, opts())
    writeFileSync(path('a.ts'), 'one\nTWO\nfour\n')
    await finalizeTurnDiff()

    const files = (emitted[0] as { files: TurnDiffFile[] }).files
    expect(files).toHaveLength(1)
    expect(files[0].status).toBe('modified')
    // 基线→最终：two→TWO、three→four
    expect(files[0].additions).toBe(2)
    expect(files[0].deletions).toBe(2)
    expect(files[0].diffText).toContain('-two')
    expect(files[0].diffText).toContain('+TWO')
    expect(files[0].diffText).toContain('+four')
    expect(files[0].diffText).toContain('-three')
  })

  it('generates a full-delete diff when the file is removed', async () => {
    writeFileSync(path('gone.ts'), 'a\nb\n')
    await captureTurnFileBaseline('edit', { path: path('gone.ts') }, opts())
    rmSync(path('gone.ts'))
    await finalizeTurnDiff()

    const files = (emitted[0] as { files: TurnDiffFile[] }).files
    expect(files[0].status).toBe('deleted')
    expect(files[0].deletions).toBe(2)
  })

  it('excludes net-zero changes', async () => {
    writeFileSync(path('same.ts'), 'same\n')
    await captureTurnFileBaseline('edit', { path: path('same.ts') }, opts())
    writeFileSync(path('same.ts'), 'same\n')
    await finalizeTurnDiff()
    expect(emitted).toHaveLength(0)
  })

  it('skips oversize files with a reason', async () => {
    configureTurnDiffSnapshotBytes(16)
    writeFileSync(path('big.ts'), 'x'.repeat(100))
    await captureTurnFileBaseline('edit', { path: path('big.ts') }, opts())
    writeFileSync(path('big.ts'), 'y'.repeat(100))
    await finalizeTurnDiff()

    const files = (emitted[0] as { files: TurnDiffFile[] }).files
    expect(files).toHaveLength(1)
    expect(files[0].skipReason).toBe('oversize')
  })

  it('skips binary files without caching', async () => {
    writeFileSync(path('bin.dat'), Buffer.from([0, 1, 2, 0, 3]))
    await captureTurnFileBaseline('edit', { path: path('bin.dat') }, opts())
    writeFileSync(path('bin.dat'), Buffer.from([9, 0, 8]))
    await finalizeTurnDiff()

    const files = (emitted[0] as { files: TurnDiffFile[] }).files
    expect(files).toHaveLength(1)
    expect(files[0].skipReason).toBe('binary')
  })

  it('skips files outside the workspace', async () => {
    const outside = join(dir, 'outside.ts')
    writeFileSync(outside, 'x')
    await captureTurnFileBaseline('edit', { path: outside }, opts())
    writeFileSync(outside, 'y')
    await finalizeTurnDiff()

    const files = (emitted[0] as { files: TurnDiffFile[] }).files
    expect(files[0].skipReason).toBe('outside_workspace')
  })

  it('is disabled when the cap is 0', async () => {
    configureTurnDiffSnapshotBytes(0)
    writeFileSync(path('off.ts'), 'a')
    await captureTurnFileBaseline('edit', { path: path('off.ts') }, opts())
    writeFileSync(path('off.ts'), 'b')
    await finalizeTurnDiff()
    expect(emitted).toHaveLength(0)
  })

  it('finalizes the previous turn when a new turn starts capturing', async () => {
    writeFileSync(path('t1.ts'), 'a')
    await captureTurnFileBaseline('edit', { path: path('t1.ts') }, opts())
    writeFileSync(path('t1.ts'), 'b')

    await captureTurnFileBaseline(
      'edit',
      { path: path('t2.ts') },
      opts({ turnId: 'turn-2', base: { ...opts().base, turnId: 'turn-2' } }),
    )
    writeFileSync(path('t2.ts'), 'x')
    await finalizeTurnDiff()
    // 兜底结算（turn-1）与新回合结算（turn-2）都是异步：等两个事件都发出
    await new Promise((r) => setTimeout(r, 30))

    expect(emitted).toHaveLength(2)
    const first = emitted[0] as { turnId?: string; files: TurnDiffFile[] }
    expect(first.turnId).toBe('turn-1')
    expect(first.files.map((f) => f.path)).toEqual([path('t1.ts')])
    const second = emitted[1] as { turnId?: string; files: TurnDiffFile[] }
    expect(second.turnId).toBe('turn-2')
  })

  it('finalize is idempotent across turn_end / agent_settled double calls', async () => {
    await captureTurnFileBaseline('write', { path: path('x.ts') }, opts())
    writeFileSync(path('x.ts'), 'content')
    await finalizeTurnDiff()
    await finalizeTurnDiff()
    expect(emitted).toHaveLength(1)
  })

  it('respects the per-turn budget', async () => {
    configureTurnDiffSnapshotBytes(1024) // 预算 = 1024*16 封顶 64MiB → 16KiB
    for (let i = 0; i < 20; i++) {
      const p = path(`f${i}.ts`)
      writeFileSync(p, 'a'.repeat(1024))
      await captureTurnFileBaseline('edit', { path: p }, opts())
      writeFileSync(p, 'b'.repeat(1024))
    }
    await finalizeTurnDiff()
    const files = (emitted[0] as { files: TurnDiffFile[] }).files
    // 16 个文件进入预算（每个 1KiB），后续文件跳过
    const skipped = files.filter((f) => f.skipReason === 'budget')
    expect(skipped.length).toBeGreaterThan(0)
  })
})
