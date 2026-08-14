import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const invoke = vi.fn()
const getState = vi.fn()
const setStateCb = vi.fn()
const setExternalSyncPhase = vi.fn()
const clearSessionHistoryCache = vi.fn()
// 模拟 zustand 的三态指示器：set 后 getState 应反映新 phase
let currentPhase: 'idle' | 'active' | 'error' = 'idle'

vi.mock('@renderer/lib/ipc-client', () => ({
  ipcClient: { invoke: (...args: unknown[]) => invoke(...args) },
}))

vi.mock('@renderer/stores/ui-store', () => ({
  useUIStore: {
    getState: () => ({ ...getState(), externalSyncPhase: currentPhase }),
    // zustand setState(updater) 返回合并结果；handleSessionExternalUpdate 用它判断是否有新增
    setState: (updater: (s: never) => unknown) => {
      const result = updater(getState() as never)
      setStateCb(result)
      return result
    },
  },
}))

vi.mock('@renderer/lib/session-worker-sync', () => ({
  composerTurnActive: () => false,
}))

vi.mock('@renderer/lib/session-history', () => ({
  clearSessionHistoryCache: (...args: unknown[]) => clearSessionHistoryCache(...args),
}))

import {
  handleSessionExternalUpdate,
  resetExternalSessionSync,
} from '../session-external-update'

const baseState = {
  historySessionFile: '/proj/sessions/a.jsonl',
  currentWorkspace: '/proj',
  historyTotalCount: 2,
  historyLoadedCount: 2,
  timelineItems: [
    { id: 'm1', type: 'user-message', text: 'hello', sessionEntryId: 'e1' },
    { id: 'm2', type: 'assistant', text: 'hi', sessionEntryId: 'e2' },
  ],
  workerLiveSnapshot: {},
  runState: {},
  streamingAssistantId: null,
  optimisticPendingUserText: null,
  sessionRuntimeRunning: {},
  agentTurnBootstrapping: false,
  setExternalSyncPhase,
}

function fullTailItems(): unknown[] {
  return [
    { id: 'm1', type: 'user-message', text: 'hello', sessionEntryId: 'e1' },
    { id: 'm2', type: 'assistant', text: 'hi', sessionEntryId: 'e2' },
    { id: 'm3', type: 'user-message', text: 'world', sessionEntryId: 'e3' },
    { id: 'm4', type: 'assistant', text: 'ok', sessionEntryId: 'e4' },
  ]
}

describe('session external update merge', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    currentPhase = 'idle'
    setExternalSyncPhase.mockImplementation((phase: 'idle' | 'active' | 'error') => {
      currentPhase = phase
    })
    getState.mockReturnValue({ ...baseState })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('merges newly appended tail into the timeline and marks sync active', async () => {
    invoke.mockResolvedValue({ items: fullTailItems(), totalCount: 4 })

    await handleSessionExternalUpdate('/proj/sessions/a.jsonl')

    expect(invoke).toHaveBeenCalledWith('session.getMessages', {
      sessionFile: '/proj/sessions/a.jsonl',
      workspaceId: '/proj',
      offset: 0,
      limit: 500,
    })
    // 外部写入必须使历史切片缓存失效（否则切换回来的 hydrate 会拿到旧尾部）
    expect(clearSessionHistoryCache).toHaveBeenCalledWith('/proj/sessions/a.jsonl')
    const updaterResult = setStateCb.mock.calls[0][0]
    expect(updaterResult).toMatchObject({ historyTotalCount: 4, historyLoadedCount: 4 })
    const items = (updaterResult as { timelineItems: Array<{ id: string }> }).timelineItems
    expect(items.map((i) => i.id)).toEqual(['m1', 'm2', 'm3', 'm4'])
    expect(setExternalSyncPhase).toHaveBeenCalledWith('active')
  })

  it('is idempotent: repeated events with no new items do not duplicate the timeline', async () => {
    getState.mockReturnValue({
      ...baseState,
      timelineItems: fullTailItems().map((i, idx) => ({ ...(i as object), id: `m${idx + 1}` })),
      historyTotalCount: 4,
      historyLoadedCount: 4,
    })
    invoke.mockResolvedValue({ items: fullTailItems(), totalCount: 4 })

    await handleSessionExternalUpdate('/proj/sessions/a.jsonl')

    const updaterResult = setStateCb.mock.calls[0][0]
    expect(updaterResult).toEqual({})
    expect(setExternalSyncPhase).not.toHaveBeenCalled()
  })

  it('ignores events for a different session file', async () => {
    await handleSessionExternalUpdate('/proj/sessions/other.jsonl')
    expect(invoke).not.toHaveBeenCalled()
    expect(setStateCb).not.toHaveBeenCalled()
  })

  it('retries a failed read and merges on the second attempt', async () => {
    invoke
      .mockRejectedValueOnce(new Error('ipc broken'))
      .mockResolvedValueOnce({ items: fullTailItems(), totalCount: 4 })

    const promise = handleSessionExternalUpdate('/proj/sessions/a.jsonl')
    await vi.advanceTimersByTimeAsync(600)
    await promise

    expect(invoke).toHaveBeenCalledTimes(2)
    expect(setExternalSyncPhase).toHaveBeenCalledWith('active')
    expect(setExternalSyncPhase).not.toHaveBeenCalledWith('error')
  })

  it('stays silent when all retries fail and no external activity was confirmed', async () => {
    invoke.mockRejectedValue(new Error('ipc broken'))

    const promise = handleSessionExternalUpdate('/proj/sessions/a.jsonl')
    await vi.advanceTimersByTimeAsync(3000)
    await promise

    expect(invoke).toHaveBeenCalledTimes(3)
    // 未确认外部活动：不亮 error（避免"没有 CLI 在跑却报外部同步异常"）
    expect(setExternalSyncPhase).not.toHaveBeenCalledWith('error')
  })

  it('marks error only when failures happen inside a confirmed external activity window', async () => {
    // 先成功合并一次 → active（确认外部活动窗口开启）
    invoke.mockResolvedValueOnce({ items: fullTailItems(), totalCount: 4 })
    await handleSessionExternalUpdate('/proj/sessions/a.jsonl')
    expect(setExternalSyncPhase).toHaveBeenCalledWith('active')

    // 窗口内（5s 未到）连续失败 → error
    invoke.mockRejectedValue(new Error('ipc broken'))
    const promise = handleSessionExternalUpdate('/proj/sessions/a.jsonl')
    await vi.advanceTimersByTimeAsync(3000)
    await promise
    expect(setExternalSyncPhase).toHaveBeenCalledWith('error')
  })

  it('error is cleared by the slow reprobe once reads succeed again', async () => {
    // 确认活动 → 失败 → error
    invoke.mockResolvedValueOnce({ items: fullTailItems(), totalCount: 4 })
    await handleSessionExternalUpdate('/proj/sessions/a.jsonl')
    invoke.mockRejectedValue(new Error('ipc broken'))
    const failing = handleSessionExternalUpdate('/proj/sessions/a.jsonl')
    await vi.advanceTimersByTimeAsync(3000)
    await failing
    expect(setExternalSyncPhase).toHaveBeenCalledWith('error')

    // 后续读取成功且无新增 → 自检解除 error
    invoke.mockResolvedValue({ items: fullTailItems(), totalCount: 4 })
    getState.mockReturnValue({
      ...baseState,
      timelineItems: fullTailItems().map((i, idx) => ({ ...(i as object), id: `m${idx + 1}` })),
      historyTotalCount: 4,
      historyLoadedCount: 4,
    })
    await vi.advanceTimersByTimeAsync(10_100)
    expect(setExternalSyncPhase).toHaveBeenCalledWith('idle')
  })

  it('resets everything on session switch: pending reads cannot mutate the new session', async () => {
    invoke.mockImplementation(
      () =>
        new Promise((resolve) => {
          setTimeout(() => resolve({ items: fullTailItems(), totalCount: 4 }), 1000)
        }),
    )
    const slow = handleSessionExternalUpdate('/proj/sessions/a.jsonl')
    // 切换会话：代际 +1，清空指示器
    resetExternalSessionSync()
    getState.mockReturnValue({
      ...baseState,
      historySessionFile: '/proj/sessions/b.jsonl',
    })
    await vi.advanceTimersByTimeAsync(1500)
    await slow
    expect(setStateCb).not.toHaveBeenCalled()
    expect(setExternalSyncPhase).not.toHaveBeenCalledWith('active')
  })

  it('coalesces concurrent notifications into one in-flight read', async () => {
    let resolveFirst: (v: unknown) => void = () => {}
    invoke.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFirst = resolve
        }),
    )
    invoke.mockResolvedValue({ items: fullTailItems(), totalCount: 4 })
    const first = handleSessionExternalUpdate('/proj/sessions/a.jsonl')
    const second = handleSessionExternalUpdate('/proj/sessions/a.jsonl')
    await vi.advanceTimersByTimeAsync(0)
    expect(invoke).toHaveBeenCalledTimes(1)

    resolveFirst({ items: fullTailItems(), totalCount: 4 })
    await first
    // 合并的第二次通知跟随执行
    await second
    expect(invoke).toHaveBeenCalledTimes(2)
  })

  it('does not append anything when the view tail anchor is not in the disk page', async () => {
    getState.mockReturnValue({
      ...baseState,
      timelineItems: [
        { id: 'm4', type: 'user-message', text: 'four', sessionEntryId: 'e4' },
        { id: 'm5', type: 'assistant', text: 'five', sessionEntryId: 'e5' },
      ],
    })
    invoke.mockResolvedValue({
      items: [
        { id: 'm100', type: 'user-message', text: 'x', sessionEntryId: 'e100' },
        { id: 'm101', type: 'assistant', text: 'y', sessionEntryId: 'e101' },
      ],
      totalCount: 102,
    })

    await handleSessionExternalUpdate('/proj/sessions/a.jsonl')

    expect(setStateCb).toHaveBeenCalledOnce()
    const updaterResult = setStateCb.mock.calls[0][0]
    expect(updaterResult).toEqual({})
    expect(setExternalSyncPhase).not.toHaveBeenCalled()
  })
})
