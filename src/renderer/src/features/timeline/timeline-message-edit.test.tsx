// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Timeline } from './timeline'
import { useUIStore } from '@renderer/stores/ui-store'
import type { TimelineItem } from '@renderer/stores/ui-store-types'

const invokeMock = vi.hoisted(() => vi.fn())
const rewindMock = vi.hoisted(() => vi.fn(async () => true))

vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-i18next')>()),
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      opts && 'defaultValue' in opts ? String(opts.defaultValue) : key,
    i18n: { language: 'zh-CN' },
  }),
}))

vi.mock('@renderer/lib/ipc-client', () => ({
  ipcClient: { invoke: invokeMock },
  onAppEvent: () => () => {},
}))

vi.mock('@renderer/lib/session-rewind', () => ({ navigateSessionToEntry: rewindMock }))
vi.mock('@renderer/lib/session-fork', () => ({ forkSessionFromEntry: vi.fn(async () => true) }))
vi.mock('@renderer/lib/rewind-metadata', () => ({ refreshSessionTree: vi.fn(async () => {}) }))
vi.mock('@renderer/lib/reload-current-session-data', () => ({ reloadCurrentSessionData: vi.fn(async () => {}) }))
vi.mock('@renderer/lib/session-chrome', () => ({
  useSessionChrome: () => ({ canStop: false, showSpinner: false, phase: 'idle', sessionKey: '/tmp/proj/s.jsonl' }),
}))

describe('Timeline in-place message editing', () => {
  beforeEach(() => {
    invokeMock.mockReset()
    rewindMock.mockReset()
    invokeMock.mockImplementation(async (channel: string) => {
      if (channel === 'session.editMessage') return { ok: true, role: 'assistant' }
      return { items: [], totalCount: 0, sourceCount: 0, sessions: [] }
    })
  })

  afterEach(() => {
    cleanup()
  })

  it('edits assistant and user messages in place without rewinding, and clears stale thinking on assistant edit', async () => {
    const now = Date.now()
    const items: TimelineItem[] = [
      {
        id: 'u-1',
        type: 'user-message',
        text: 'Original user question',
        timestamp: now - 10_000,
        sessionEntryId: 'entry-u1',
      },
      {
        id: 'a-1',
        type: 'assistant-message',
        text: 'Original refusal response',
        thinkingText: 'Internal refusal reasoning',
        timestamp: now - 5_000,
        sessionEntryId: 'entry-a1',
      },
    ]

    useUIStore.setState({
      currentWorkspace: '/tmp/proj',
      historySessionFile: '/tmp/proj/s.jsonl',
      currentSessionId: 's',
      timelineItems: items,
      historyTotalCount: items.length,
      historyLoadedCount: items.length,
      historyLoading: false,
      streamingAssistantId: null,
      optimisticPendingUserText: null,
      agentTurnBootstrapping: false,
      subagentSessionGroup: null,
      runState: { status: 'idle', toolCount: 0, errorCount: 0 } as never,
      sessionRuntimeRunning: {},
      workerLiveSnapshot: { status: 'idle', sessionFile: '/tmp/proj/s.jsonl', sessionId: 's' } as never,
    })

    render(<Timeline />)

    const editButtons = screen.getAllByLabelText('timeline:editMessage')
    expect(editButtons).toHaveLength(2)

    // Edit assistant message via Ctrl+Enter
    fireEvent.click(editButtons[1])
    const assistantEditor = screen.getByTestId('message-inline-editor-assistant') as HTMLTextAreaElement
    expect(assistantEditor.value).toBe('Original refusal response')

    // Escape cancels cleanly first
    fireEvent.keyDown(assistantEditor, { key: 'Escape' })
    expect(screen.queryByTestId('message-inline-editor-assistant')).not.toBeInTheDocument()
    expect(invokeMock).not.toHaveBeenCalledWith('session.editMessage', expect.anything())

    // Re-open and save forged response
    fireEvent.click(screen.getAllByLabelText('timeline:editMessage')[1])
    const reopened = screen.getByTestId('message-inline-editor-assistant') as HTMLTextAreaElement
    fireEvent.change(reopened, { target: { value: 'Forged compliant reply' } })
    fireEvent.keyDown(reopened, { key: 'Enter', ctrlKey: true })

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('session.editMessage', {
        sessionFile: '/tmp/proj/s.jsonl',
        workspaceId: '/tmp/proj',
        entryId: 'entry-a1',
        text: 'Forged compliant reply',
      })
    })

    await waitFor(() => {
      expect(screen.queryByTestId('message-inline-editor-assistant')).not.toBeInTheDocument()
    })

    const updatedAssistant = useUIStore.getState().timelineItems.find((i) => i.id === 'a-1')
    expect(updatedAssistant?.text).toBe('Forged compliant reply')
    expect(updatedAssistant?.thinkingText).toBeUndefined()
    expect(rewindMock).not.toHaveBeenCalled()
  })

  it('keeps own entryId for editing an empty interrupted/errored assistant row while rewind still targets previous user', async () => {
    const now = Date.now()
    const items: TimelineItem[] = [
      {
        id: 'u-1',
        type: 'user-message',
        text: 'Blocked prompt',
        timestamp: now - 8_000,
        sessionEntryId: 'entry-u1',
      },
      {
        id: 'a-err',
        type: 'assistant-message',
        text: '',
        thinkingText: '',
        incomplete: true,
        stopReason: 'error',
        timestamp: now - 4_000,
        sessionEntryId: 'entry-a-err',
      },
    ]

    useUIStore.setState({
      currentWorkspace: '/tmp/proj',
      historySessionFile: '/tmp/proj/s.jsonl',
      currentSessionId: 's',
      timelineItems: items,
      historyTotalCount: items.length,
      historyLoadedCount: items.length,
      historyLoading: false,
      streamingAssistantId: null,
      optimisticPendingUserText: null,
      agentTurnBootstrapping: false,
      subagentSessionGroup: null,
      runState: { status: 'idle', toolCount: 0, errorCount: 0 } as never,
      sessionRuntimeRunning: {},
      workerLiveSnapshot: { status: 'idle', sessionFile: '/tmp/proj/s.jsonl', sessionId: 's' } as never,
    })

    render(<Timeline />)

    const editButtons = screen.getAllByLabelText('timeline:editMessage')
    expect(editButtons).toHaveLength(2)

    // Click edit on the empty errored assistant row
    fireEvent.click(editButtons[1])
    const editor = screen.getByTestId('message-inline-editor-assistant') as HTMLTextAreaElement
    fireEvent.change(editor, { target: { value: 'Recovered assistant answer' } })
    fireEvent.click(screen.getByText('timeline:edit.save'))

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('session.editMessage', {
        sessionFile: '/tmp/proj/s.jsonl',
        workspaceId: '/tmp/proj',
        entryId: 'entry-a-err',
        text: 'Recovered assistant answer',
      })
    })

    const updated = useUIStore.getState().timelineItems.find((i) => i.id === 'a-err')
    expect(updated?.text).toBe('Recovered assistant answer')
    expect(updated?.incomplete).toBeUndefined()
    expect(updated?.stopReason).toBe('stop')
  })

  it('exposes floating hover edit actions on intermediate assistant prose messages inside a multi-step turn', async () => {
    const now = Date.now()
    const items: TimelineItem[] = [
      {
        id: 'u1',
        type: 'user-message',
        text: 'Build and package',
        timestamp: now - 10_000,
        sessionEntryId: 'entry-u1',
      },
      {
        id: 'a-mid',
        type: 'assistant-message',
        text: 'Intermediate status message before tool',
        timestamp: now - 8_000,
        sessionEntryId: 'entry-a-mid',
      },
      {
        id: 't1',
        type: 'tool-call',
        toolCallId: 'tc-1',
        toolName: 'bash',
        toolPhase: 'end',
        toolOutput: 'ok',
        timestamp: now - 6_000,
      },
      {
        id: 'a-last',
        type: 'assistant-message',
        text: 'Final summary message',
        timestamp: now - 4_000,
        sessionEntryId: 'entry-a-last',
      },
    ]

    useUIStore.setState({
      currentWorkspace: '/tmp/proj',
      historySessionFile: '/tmp/proj/s.jsonl',
      currentSessionId: 's',
      timelineItems: items,
      historyTotalCount: items.length,
      historyLoadedCount: items.length,
      historyLoading: false,
      streamingAssistantId: null,
      optimisticPendingUserText: null,
      agentTurnBootstrapping: false,
      subagentSessionGroup: null,
      runState: { status: 'idle', toolCount: 0, errorCount: 0 } as never,
      sessionRuntimeRunning: {},
      workerLiveSnapshot: { status: 'idle', sessionFile: '/tmp/proj/s.jsonl', sessionId: 's' } as never,
    })

    render(<Timeline />)

    // User + intermediate assistant + final assistant all expose edit buttons
    const editButtons = screen.getAllByLabelText('timeline:editMessage')
    expect(editButtons).toHaveLength(3)

    // Edit the intermediate assistant message specifically
    fireEvent.click(editButtons[1])
    const editor = screen.getByTestId('message-inline-editor-assistant') as HTMLTextAreaElement
    expect(editor.value).toBe('Intermediate status message before tool')
    fireEvent.change(editor, { target: { value: 'Edited intermediate prose' } })
    fireEvent.click(screen.getByText('timeline:edit.save'))

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('session.editMessage', {
        sessionFile: '/tmp/proj/s.jsonl',
        workspaceId: '/tmp/proj',
        entryId: 'entry-a-mid',
        text: 'Edited intermediate prose',
      })
    })
  })
})
