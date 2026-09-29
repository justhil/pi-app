import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ipcClient } from '@renderer/lib/ipc-client'
import { useUIStore } from '@renderer/stores/ui-store'
import {
  clearContextPreviewCacheForTests,
  useSessionContextPreview,
} from './use-session-context-preview'

vi.mock('@renderer/lib/ipc-client', () => ({
  ipcClient: { invoke: vi.fn(() => Promise.resolve({})) },
}))

function contextPreviewCalls(): number {
  return vi.mocked(ipcClient.invoke).mock.calls.filter(([channel]) => channel === 'context.preview').length
}

describe('useSessionContextPreview shared requests', () => {
  beforeEach(() => {
    clearContextPreviewCacheForTests()
    vi.mocked(ipcClient.invoke).mockReset()
    vi.mocked(ipcClient.invoke).mockImplementation(async (channel: string) =>
      channel === 'context.preview'
        ? { preview: { sessionFile: '/sessions/a.jsonl', messageCount: 3, estimatedChars: 30 } }
        : {},
    )
    useUIStore.setState({
      currentWorkspace: '/workspace',
      currentSessionId: 'session-a',
      historySessionFile: '/sessions/a.jsonl',
      historyLoading: false,
      runState: { status: 'idle', toolCount: 0, errorCount: 0 },
    })
  })

  // Composer metrics, the Run panel and the Context panel all show the same session context.
  it('issues one context.preview for concurrent consumers of the same session', async () => {
    const hooks = [
      renderHook(() => useSessionContextPreview()),
      renderHook(() => useSessionContextPreview()),
      renderHook(() => useSessionContextPreview()),
    ]

    for (const hook of hooks) {
      await waitFor(() => expect(hook.result.current.preview?.estimatedChars).toBe(30))
    }
    expect(contextPreviewCalls()).toBe(1)
  })

  it('refetches once for all consumers when the turn ends', async () => {
    useUIStore.setState({ runState: { status: 'running', toolCount: 0, errorCount: 0 } })
    const first = renderHook(() => useSessionContextPreview())
    const second = renderHook(() => useSessionContextPreview())
    await waitFor(() => expect(first.result.current.preview).not.toBeNull())
    await waitFor(() => expect(second.result.current.preview).not.toBeNull())
    const before = contextPreviewCalls()

    act(() => {
      useUIStore.setState({ runState: { status: 'idle', toolCount: 0, errorCount: 0 } })
    })

    await waitFor(() => expect(contextPreviewCalls()).toBe(before + 1))
    expect(contextPreviewCalls()).toBe(before + 1)
  })
})
