import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ipcClient } from '@renderer/lib/ipc-client'
import { useUIStore } from '@renderer/stores/ui-store'
import { useComposerMetrics } from './use-composer-metrics'

vi.mock('@renderer/lib/ipc-client', () => ({
  ipcClient: { invoke: vi.fn(() => Promise.resolve({})) },
}))

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

describe('useComposerMetrics context isolation', () => {
  beforeEach(() => {
    vi.mocked(ipcClient.invoke).mockReset()
    useUIStore.setState({
      currentWorkspace: '/workspace',
      currentSessionId: 'session-a',
      historySessionFile: '/sessions/a.jsonl',
      historyLoading: false,
      runState: {
        status: 'idle',
        model: undefined,
        usage: undefined,
        toolCount: 0,
        errorCount: 0,
      },
      streamingAssistantId: null,
      timelineItems: [],
    })
  })

  it('requests context for the visible session file', async () => {
    vi.mocked(ipcClient.invoke).mockResolvedValue({
      preview: {
        sessionFile: '/sessions/a.jsonl',
        messageCount: 1,
        estimatedChars: 10,
      },
    })

    renderHook(() => useComposerMetrics())

    await waitFor(() => {
      expect(ipcClient.invoke).toHaveBeenCalledWith('context.preview', {
        sessionFile: '/sessions/a.jsonl',
        workspaceId: '/workspace',
      })
    })
  })

  it('ignores a late response from the previous session', async () => {
    const first = deferred<{
      preview: { sessionFile: string; messageCount: number; estimatedChars: number }
    }>()
    vi.mocked(ipcClient.invoke).mockImplementation((channel, request) => {
      if (channel !== 'context.preview') return Promise.resolve({})
      const sessionFile = (request as { sessionFile?: string } | undefined)?.sessionFile
      if (sessionFile === '/sessions/a.jsonl') return first.promise
      return Promise.resolve({
        preview: {
          sessionFile: '/sessions/b.jsonl',
          messageCount: 2,
          estimatedChars: 20,
        },
      })
    })
    const { result } = renderHook(() => useComposerMetrics())

    act(() => {
      useUIStore.setState({
        currentSessionId: 'session-b',
        historySessionFile: '/sessions/b.jsonl',
      })
    })
    await waitFor(() => expect(result.current.contextPreview?.estimatedChars).toBe(20))

    await act(async () => {
      first.resolve({
        preview: {
          sessionFile: '/sessions/a.jsonl',
          messageCount: 1,
          estimatedChars: 10,
        },
      })
      await first.promise
    })

    expect(result.current.contextPreview?.estimatedChars).toBe(20)
  })
})
