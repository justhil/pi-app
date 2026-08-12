import { describe, expect, it, vi } from 'vitest'
import { confirmSdkSelection } from './sdk-selection-transaction'

describe('SDK selection transaction', () => {
  it('rolls back when target verification fails', async () => {
    const verifySelection = vi
      .fn()
      .mockRejectedValueOnce(new Error('target import failed'))
      .mockResolvedValueOnce({ kind: 'builtin', version: 'test' })
    const restartWorker = vi.fn(async () => {})
    const rollbackSelection = vi.fn(async () => {})

    await expect(
      confirmSdkSelection({
        target: 'user',
        rollbackTarget: { kind: 'builtin' },
        restartWorker,
        verifySelection,
        rollbackSelection,
      }),
    ).rejects.toThrow('目标失败: target import failed；已回滚到 builtin')

    expect(rollbackSelection).toHaveBeenCalledWith({ kind: 'builtin' })
    expect(restartWorker).toHaveBeenCalledTimes(2)
    expect(verifySelection).toHaveBeenNthCalledWith(1, 'user')
    expect(verifySelection).toHaveBeenNthCalledWith(2, 'builtin')
  })

  it('returns the verified active runtime', async () => {
    const active = { kind: 'user' as const, version: '1.2.3' }

    await expect(
      confirmSdkSelection({
        target: 'user',
        rollbackTarget: { kind: 'builtin' },
        restartWorker: vi.fn(async () => {}),
        verifySelection: vi.fn(async (target) => ({ ...active, kind: target })),
        rollbackSelection: vi.fn(),
      }),
    ).resolves.toEqual(active)
  })

  it('rejects and rolls back when active kind does not match the selected target', async () => {
    const verifySelection = vi
      .fn()
      .mockResolvedValueOnce({ kind: 'builtin', version: 'test' })
      .mockResolvedValueOnce({ kind: 'builtin', version: 'test' })
    const rollbackSelection = vi.fn(async () => {})
    const restartWorker = vi.fn(async () => {})

    await expect(
      confirmSdkSelection({
        target: 'global',
        rollbackTarget: { kind: 'builtin' },
        verifySelection,
        restartWorker,
        rollbackSelection,
      }),
    ).rejects.toThrow('预期 global，实际 builtin')

    expect(rollbackSelection).toHaveBeenCalledWith({ kind: 'builtin' })
    expect(restartWorker).toHaveBeenCalledTimes(2)
  })

  it('preserves target and rollback failures when rollback selection fails', async () => {
    await expect(
      confirmSdkSelection({
        target: 'user',
        rollbackTarget: { kind: 'builtin' },
        verifySelection: vi.fn(async () => {
          throw new Error('target import failed')
        }),
        restartWorker: vi.fn(async () => {}),
        rollbackSelection: vi.fn(async () => {
          throw new Error('current.json write failed')
        }),
      }),
    ).rejects.toThrow('目标失败: target import failed；回滚失败: current.json write failed')
  })

  it('preserves target and rollback failures when the rollback target cannot be verified', async () => {
    const verifySelection = vi
      .fn()
      .mockRejectedValueOnce(new Error('target import failed'))
      .mockResolvedValueOnce({ kind: 'user', version: 'bad' })

    await expect(
      confirmSdkSelection({
        target: 'user',
        rollbackTarget: { kind: 'builtin' },
        verifySelection,
        restartWorker: vi.fn(async () => {}),
        rollbackSelection: vi.fn(async () => {}),
      }),
    ).rejects.toThrow('目标失败: target import failed；回滚失败: 预期 builtin，实际 user')
  })

  it('preserves target and rollback failures when rollback worker restart fails', async () => {
    const restartWorker = vi
      .fn()
      .mockRejectedValueOnce(new Error('target worker failed'))
      .mockRejectedValueOnce(new Error('rollback worker failed'))

    await expect(
      confirmSdkSelection({
        target: 'global',
        rollbackTarget: { kind: 'builtin' },
        verifySelection: vi.fn(async (target) => ({ kind: target, version: 'test' })),
        restartWorker,
        rollbackSelection: vi.fn(async () => {}),
      }),
    ).rejects.toThrow('目标失败: target worker failed；回滚失败: rollback worker failed')
  })
})
