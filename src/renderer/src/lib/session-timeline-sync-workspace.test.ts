import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useUIStore } from '@renderer/stores/ui-store'

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
}))

vi.mock('@renderer/lib/ipc-client', () => ({
  ipcClient: {
    invoke: (...args: unknown[]) => mocks.invoke(...args) ?? Promise.resolve({}),
  },
}))

import { prependOlderTimelinePage } from './timeline-history-prepend'

describe('session timeline history workspace contract', () => {
  beforeEach(() => {
    mocks.invoke.mockReset()
    mocks.invoke.mockResolvedValue({ items: [], sourceCount: 0, totalCount: 0 })
    useUIStore.setState({
      currentWorkspace: '/workspace/current',
      historyLoadedCount: 0,
      historyTotalCount: 0,
      timelineItems: [],
    })
  })

  it('passes the current workspace when prepending history', async () => {
    await prependOlderTimelinePage('/sessions/history.jsonl', 80, 40)

    expect(mocks.invoke).toHaveBeenCalledWith('session.getMessages', {
      sessionFile: '/sessions/history.jsonl',
      workspaceId: '/workspace/current',
      offset: 80,
      limit: 40,
    })
  })
})
