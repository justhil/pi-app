import { beforeEach, describe, expect, it, vi } from 'vitest'

const invoke = vi.fn()
const getState = vi.fn()
const setStateCb = vi.fn()

vi.mock('@renderer/lib/ipc-client', () => ({
  ipcClient: { invoke: (...args: unknown[]) => invoke(...args) },
}))

vi.mock('@renderer/stores/ui-store', () => ({
  useUIStore: {
    getState: () => getState(),
    setState: (updater: unknown) => setStateCb(updater as never),
  },
}))

vi.mock('@renderer/lib/session-worker-sync', () => ({
  composerTurnActive: () => false,
}))

import { handleSessionExternalUpdate, isCurrentSessionExternallyUpdated } from '../session-external-update'

const baseState = {
  historySessionFile: '/proj/sessions/a.jsonl',
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
}

describe('session external update merge', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getState.mockReturnValue({ ...baseState })
  })

  it('merges newly appended tail into the timeline and lights the badge', async () => {
    // 尾部页包含全部条目（含已加载的旧条目），按 id 过滤后只追加新增部分
    invoke.mockResolvedValue({
      items: [
        { id: 'm1', type: 'user-message', text: 'hello', sessionEntryId: 'e1' },
        { id: 'm2', type: 'assistant', text: 'hi', sessionEntryId: 'e2' },
        { id: 'm3', type: 'user-message', text: 'world', sessionEntryId: 'e3' },
        { id: 'm4', type: 'assistant', text: 'ok', sessionEntryId: 'e4' },
      ],
      totalCount: 4,
    })

    await handleSessionExternalUpdate('/proj/sessions/a.jsonl')

    expect(invoke).toHaveBeenCalledWith('session.getMessages', {
      sessionFile: '/proj/sessions/a.jsonl',
      offset: 0,
      limit: 0,
    })
    expect(setStateCb).toHaveBeenCalledOnce()

    // Apply the captured updater to the base state and verify the merge result
    const updater = setStateCb.mock.calls[0][0]
    const result = updater({ ...baseState })
    expect(result).toMatchObject({
      historyTotalCount: 4,
      historyLoadedCount: 4,
      externalUpdateFor: '/proj/sessions/a.jsonl',
    })
    const items = (result as { timelineItems: Array<{ id: string }> }).timelineItems
    expect(items.map((i) => i.id)).toEqual(['m1', 'm2', 'm3', 'm4'])
  })

  it('is idempotent: repeated events with no new items do not duplicate the timeline', async () => {
    // 状态已包含全部 4 条（首次合并后的视图），磁盘返回相同内容 → 无新增 → 不重复
    getState.mockReturnValue({
      ...baseState,
      timelineItems: [
        { id: 'm1', type: 'user-message', text: 'hello', sessionEntryId: 'e1' },
        { id: 'm2', type: 'assistant', text: 'hi', sessionEntryId: 'e2' },
        { id: 'm3', type: 'user-message', text: 'world', sessionEntryId: 'e3' },
        { id: 'm4', type: 'assistant', text: 'ok', sessionEntryId: 'e4' },
      ],
      historyTotalCount: 4,
      historyLoadedCount: 4,
      externalUpdateFor: '/proj/sessions/a.jsonl',
    })
    invoke.mockResolvedValue({
      items: [
        { id: 'm1', type: 'user-message', text: 'hello', sessionEntryId: 'e1' },
        { id: 'm2', type: 'assistant', text: 'hi', sessionEntryId: 'e2' },
        { id: 'm3', type: 'user-message', text: 'world', sessionEntryId: 'e3' },
        { id: 'm4', type: 'assistant', text: 'ok', sessionEntryId: 'e4' },
      ],
      totalCount: 4,
    })

    await handleSessionExternalUpdate('/proj/sessions/a.jsonl')

    const updater = setStateCb.mock.calls[0][0]
    const result = updater({
      ...baseState,
      timelineItems: [
        { id: 'm1', type: 'user-message', text: 'hello', sessionEntryId: 'e1' },
        { id: 'm2', type: 'assistant', text: 'hi', sessionEntryId: 'e2' },
        { id: 'm3', type: 'user-message', text: 'world', sessionEntryId: 'e3' },
        { id: 'm4', type: 'assistant', text: 'ok', sessionEntryId: 'e4' },
      ],
      historyTotalCount: 4,
    })
    expect(result).toEqual({})
  })

  it('ignores events for a different session file', async () => {
    await handleSessionExternalUpdate('/proj/sessions/other.jsonl')
    expect(invoke).not.toHaveBeenCalled()
    expect(setStateCb).not.toHaveBeenCalled()
  })

  it('does not re-light the badge when no new items exist on disk', async () => {
    invoke.mockResolvedValue({ items: [], totalCount: 2 })
    getState.mockReturnValue({ ...baseState, externalUpdateFor: '/proj/sessions/a.jsonl' })

    await handleSessionExternalUpdate('/proj/sessions/a.jsonl')

    expect(setStateCb).not.toHaveBeenCalled()
    // Badge only reflects state; with no new items the store keeps its prior value.
    getState.mockReturnValue({ ...baseState, externalUpdateFor: '/proj/sessions/a.jsonl' })
    expect(isCurrentSessionExternallyUpdated()).toBe(true)
  })

  it('badge is inactive when externalUpdateFor refers to another session', () => {
    getState.mockReturnValue({ ...baseState, externalUpdateFor: '/proj/sessions/old.jsonl' })
    expect(isCurrentSessionExternallyUpdated()).toBe(false)
  })
})
