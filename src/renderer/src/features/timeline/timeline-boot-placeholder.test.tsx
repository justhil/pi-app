// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Timeline } from './timeline'
import { useUIStore } from '@renderer/stores/ui-store'
import type { TimelineItem } from '@renderer/stores/ui-store-types'

vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-i18next')>()),
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      opts && 'defaultValue' in opts ? String(opts.defaultValue) : key,
  }),
}))
vi.mock('@renderer/lib/ipc-client', () => ({
  ipcClient: { invoke: vi.fn(async () => ({ items: [], totalCount: 0, sourceCount: 0 })) },
  onAppEvent: () => () => {},
}))
vi.mock('@renderer/lib/session-rewind', () => ({ navigateSessionToEntry: vi.fn(async () => true) }))
vi.mock('@renderer/lib/session-fork', () => ({ forkSessionFromEntry: vi.fn(async () => true) }))
vi.mock('@renderer/lib/reload-current-session-data', () => ({ reloadCurrentSessionData: vi.fn(async () => {}) }))
vi.mock('@renderer/lib/session-chrome', () => ({
  useSessionChrome: () => ({ canStop: true, showSpinner: true, phase: 'working', sessionKey: '/tmp/proj/s.jsonl' }),
}))

describe('Timeline boot placeholder scoping', () => {
  afterEach(() => {
    cleanup()
  })

  it('should_only_render_one_ReplyPlaceholder_on_live_tail_and_keep_earlier_interrupted_empty_assistant_static', () => {
    const now = Date.now()
    const items: TimelineItem[] = [
      {
        id: 'u-prev',
        type: 'user-message',
        text: 'Previous turn prompt',
        timestamp: now - 30_000,
        sessionEntryId: 'e-u1',
      },
      {
        id: 't-prev',
        type: 'tool-call',
        toolName: 'edit',
        toolPhase: 'end',
        toolArgs: { path: 'client.ts', edits: [] },
        timestamp: now - 28_000,
      },
      {
        id: 'a-prev-aborted',
        type: 'assistant-message',
        text: '',
        thinkingText: '',
        incomplete: true,
        stopReason: 'aborted',
        timestamp: now - 26_000,
        sessionEntryId: 'e-a1',
      },
      {
        id: 'u-curr',
        type: 'user-message',
        text: '继续',
        timestamp: now - 7_000,
        sessionEntryId: 'e-u2',
      },
      {
        id: 'opt-asst-curr',
        type: 'assistant-message',
        text: '',
        thinkingText: '',
        timestamp: now - 7_000,
      },
    ]

    useUIStore.setState({
      currentWorkspace: '/tmp/proj',
      historySessionFile: '/tmp/proj/s.jsonl',
      timelineItems: items,
      historyTotalCount: items.length,
      historyLoadedCount: items.length,
      historyLoading: false,
      streamingAssistantId: null,
      optimisticPendingUserText: null,
      agentTurnBootstrapping: true,
      pendingTurnStage: 'sending',
      runState: { status: 'running', toolCount: 0, errorCount: 0 } as never,
      sessionRuntimeRunning: { '/tmp/proj/s.jsonl': true },
      workerLiveSnapshot: { status: 'running', sessionFile: '/tmp/proj/s.jsonl', sessionId: 's' } as never,
    })

    const { container } = render(<Timeline />)
    const placeholders = container.querySelectorAll('.reply-placeholder')
    expect(placeholders).toHaveLength(1)
    expect(screen.getByText(/回复未完成/)).toBeInTheDocument()
  })
})
