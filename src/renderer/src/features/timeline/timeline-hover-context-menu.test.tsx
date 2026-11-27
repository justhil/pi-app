// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  __resetTimelineHoverGuardForTests,
  attachTimelineScrollHoverGuard,
  canActivateTimelineHover,
} from './timeline-hover-guard'
import { MessageHoverShell } from './message-hover-actions'
import { TimelineContextMenuHost, closeTimelineContextMenu } from './timeline-context-menu'
import { ToolCallRow } from './tool-call-row'
import { ToolGroupSummary } from './tool-group-summary'
import { Timeline } from './timeline'
import { useUIStore } from '@renderer/stores/ui-store'
import type { TimelineItem } from '@renderer/stores/ui-store-types'

const rewindMock = vi.hoisted(() => vi.fn().mockResolvedValue(true))
const invokeMock = vi.hoisted(() => vi.fn().mockResolvedValue({ ok: true }))

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-i18next')>()
  return {
    ...actual,
    useTranslation: () => ({ t: (k: string) => k }),
  }
})
vi.mock('@renderer/lib/session-rewind', () => ({
  navigateSessionToEntry: rewindMock,
}))
vi.mock('@renderer/lib/ipc-client', () => ({
  ipcClient: { invoke: invokeMock },
}))
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
}))

if (typeof ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
}

describe('timeline hover guard (scroll lock + pointer gate + single active owner)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    __resetTimelineHoverGuardForTests()
  })

  afterEach(() => {
    cleanup()
    closeTimelineContextMenu()
    __resetTimelineHoverGuardForTests()
    vi.useRealTimers()
  })

  it('suppresses hover while scrolling, stays locked until real pointer movement >= 4px, and enforces single active owner', () => {
    const scrollHost = document.createElement('div')
    document.body.appendChild(scrollHost)
    const detach = attachTimelineScrollHoverGuard(scrollHost)

    const { container } = render(
      <div>
        <MessageHoverShell align="left" floating actions={<button type="button">Edit A</button>}>
          <div>Message A</div>
        </MessageHoverShell>
        <MessageHoverShell align="left" floating actions={<button type="button">Edit B</button>}>
          <div>Message B</div>
        </MessageHoverShell>
      </div>,
    )

    const shells = container.querySelectorAll('.message-hover-shell')
    const slots = container.querySelectorAll('.message-actions-slot')

    // 1. Hover A activates after floating delay (135ms)
    fireEvent.mouseEnter(shells[0])
    expect(slots[0]).not.toHaveClass('message-actions-slot-visible')
    act(() => vi.advanceTimersByTime(150))
    expect(slots[0]).toHaveClass('message-actions-slot-visible')

    // 2. Hovering B immediately dismisses A (single active owner — no ghost trail)
    fireEvent.mouseLeave(shells[0])
    fireEvent.mouseEnter(shells[1])
    act(() => vi.advanceTimersByTime(150))
    expect(slots[1]).toHaveClass('message-actions-slot-visible')
    expect(slots[0]).not.toHaveClass('message-actions-slot-visible')

    // 3. Wheel/scroll immediately locks hover and sets data-scrolling="true"
    fireEvent.wheel(scrollHost, { deltaY: 120 })
    expect(scrollHost.dataset.scrolling).toBe('true')
    expect(canActivateTimelineHover()).toBe(false)
    expect(slots[1]).not.toHaveClass('message-actions-slot-visible')

    // Even after scroll settles (140ms), stationary pointer stays locked
    act(() => vi.advanceTimersByTime(200))
    expect(scrollHost.dataset.scrolling).toBeUndefined()
    expect(canActivateTimelineHover()).toBe(false)

    // Mouse enters A with stationary pointer -> must NOT show
    fireEvent.mouseEnter(shells[0])
    act(() => vi.advanceTimersByTime(200))
    expect(slots[0]).not.toHaveClass('message-actions-slot-visible')

    // Real pointer movement >= 4px over message A unlocks and activates ONLY A (not scrolled-away B)
    fireEvent.mouseMove(shells[0], { clientX: 100, clientY: 100 })
    fireEvent.mouseMove(shells[0], { clientX: 106, clientY: 102 })
    expect(canActivateTimelineHover()).toBe(true)
    act(() => vi.advanceTimersByTime(150))
    expect(slots[0]).toHaveClass('message-actions-slot-visible')
    expect(slots[1]).not.toHaveClass('message-actions-slot-visible')

    detach()
    scrollHost.remove()
  })
})

describe('timeline context menus for messages and tool steps', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    __resetTimelineHoverGuardForTests()
    useUIStore.setState({
      currentWorkspace: '/proj',
      historySessionFile: '/proj/s.jsonl',
      currentSessionId: 's',
      toolExpandBySession: {},
      fileChanges: [],
      subagentSessionGroup: null,
      runState: { status: 'idle', toolCount: 0, errorCount: 0 } as never,
      sessionRuntimeRunning: {},
      workerLiveSnapshot: { status: 'idle', sessionFile: '/proj/s.jsonl', sessionId: 's' } as never,
    })
  })

  afterEach(() => {
    cleanup()
    closeTimelineContextMenu()
  })

  it('right-clicking a tool call row rewinds to its persisted toolResultEntryId', () => {
    render(
      <>
        <ToolCallRow
          item={{
            id: 't1',
            type: 'tool-call',
            toolCallId: 'tc-1',
            toolName: 'bash',
            toolPhase: 'end',
            toolArgs: { command: 'echo hi' },
            toolOutput: 'hi',
            sessionEntryId: 'asst-entry-1',
            toolResultEntryId: 'tool-result-entry-1',
          }}
        />
        <TimelineContextMenuHost />
      </>,
    )

    fireEvent.contextMenu(screen.getByRole('button'))
    const rewindItem = screen.getByTestId('ctx-item-rewind-tool-step')
    fireEvent.click(rewindItem)
    expect(rewindMock).toHaveBeenCalledWith('tool-result-entry-1')
  })

  it('right-clicking a collapsed tool group rewinds to the last tool step in the group', () => {
    render(
      <>
        <ToolGroupSummary
          groupId="grp-1"
          tools={[
            {
              id: 't1',
              toolName: 'read',
              toolPhase: 'end',
              sessionEntryId: 'asst-1',
              toolResultEntryId: 'tr-1',
            },
            {
              id: 't2',
              toolName: 'edit',
              toolPhase: 'end',
              sessionEntryId: 'asst-2',
              toolResultEntryId: 'tr-2',
            },
          ]}
        />
        <TimelineContextMenuHost />
      </>,
    )

    fireEvent.contextMenu(screen.getByRole('button'))
    const rewindGroupItem = screen.getByTestId('ctx-item-rewind-tool-group')
    fireEvent.click(rewindGroupItem)
    expect(rewindMock).toHaveBeenCalledWith('tr-2')
  })

  it('right-clicking an intermediate assistant message opens edit & rewind dual-entry menu', () => {
    const now = Date.now()
    const items: TimelineItem[] = [
      {
        id: 'u1',
        type: 'user-message',
        text: 'Do multi-step work',
        timestamp: now - 9_000,
        sessionEntryId: 'entry-u1',
      },
      {
        id: 'a-mid',
        type: 'assistant-message',
        text: 'Middle prose step',
        timestamp: now - 7_000,
        sessionEntryId: 'entry-a-mid',
      },
      {
        id: 't1',
        type: 'tool-call',
        toolCallId: 'tc-9',
        toolName: 'bash',
        toolPhase: 'end',
        toolOutput: 'ok',
        timestamp: now - 5_000,
        sessionEntryId: 'entry-a-mid',
        toolResultEntryId: 'entry-tr-9',
      },
      {
        id: 'a-last',
        type: 'assistant-message',
        text: 'Final step',
        timestamp: now - 3_000,
        sessionEntryId: 'entry-a-last',
      },
    ]

    useUIStore.setState({
      timelineItems: items,
      historyTotalCount: items.length,
      historyLoadedCount: items.length,
      historyLoading: false,
      streamingAssistantId: null,
      optimisticPendingUserText: null,
      agentTurnBootstrapping: false,
    })

    render(<Timeline />)

    const midText = screen.getByText('Middle prose step')
    fireEvent.contextMenu(midText)
    expect(screen.getByTestId('timeline-context-menu')).toBeInTheDocument()

    // Clicking Edit inside context menu opens inline editor for that exact intermediate message
    fireEvent.click(screen.getByTestId('ctx-item-edit-message'))
    const editor = screen.getByTestId('message-inline-editor-assistant') as HTMLTextAreaElement
    expect(editor.value).toBe('Middle prose step')
  })
})
