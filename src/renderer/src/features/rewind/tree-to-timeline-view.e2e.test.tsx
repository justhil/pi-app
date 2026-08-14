import { act, fireEvent, render, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TreePanel } from './tree-panel'
import { Timeline } from '../timeline/timeline'
import { useUIStore } from '@renderer/stores/ui-store'
import { ipcClient } from '@renderer/lib/ipc-client'
import type { TimelineItem } from '@renderer/stores/ui-store-types'

vi.mock('@renderer/lib/ipc-client', () => ({
  ipcClient: { invoke: vi.fn(async () => ({ items: [], totalCount: 0, sourceCount: 0 })) },
}))
vi.mock('@renderer/lib/session-rewind', () => ({ navigateSessionToEntry: vi.fn(async () => true) }))
vi.mock('@renderer/lib/session-fork', () => ({ forkSessionFromEntry: vi.fn(async () => true) }))
vi.mock('@renderer/lib/reload-current-session-data', () => ({
  reloadCurrentSessionData: vi.fn(async () => {}),
}))
vi.mock('@renderer/lib/rewind-metadata', () => ({ refreshSessionTree: vi.fn(async () => {}) }))
vi.mock('@renderer/lib/session-chrome', () => ({
  useSessionChrome: () => ({ canStop: false, showSpinner: false, sessionKey: '/tmp/proj/s.jsonl' }),
}))

const message = (idx: number, role: 'user' | 'assistant'): TimelineItem =>
  ({
    id: `item-${idx}`,
    type: role === 'user' ? 'user-message' : 'assistant-message',
    text: `message-${idx}`,
    timestamp: idx * 1000,
    sessionEntryId: `entry-${idx}`,
  }) as TimelineItem

const TOTAL = 60
const treeNodes = [
  { id: 'entry-50', depth: 0, entryType: 'message', role: 'user', preview: 'message-50', isLeaf: false },
  { id: 'entry-51', depth: 1, entryType: 'message', role: 'assistant', preview: 'message-51', isLeaf: false },
  { id: 'entry-5', depth: 2, entryType: 'message', role: 'user', preview: 'message-5', isLeaf: false },
  { id: 'entry-6', depth: 3, entryType: 'message', role: 'assistant', preview: 'message-6', isLeaf: true },
] as never

beforeEach(() => {
  const items: TimelineItem[] = []
  for (let i = 0; i < TOTAL; i++) items.push(message(i, i % 2 === 0 ? 'user' : 'assistant'))
  useUIStore.setState({
    currentWorkspace: '/tmp/proj',
    historySessionFile: '/tmp/proj/s.jsonl',
    timelineItems: items,
    historyTotalCount: TOTAL,
    historyLoadedCount: TOTAL,
    historyLoading: false,
    streamingAssistantId: null,
    optimisticPendingUserText: null,
    agentTurnBootstrapping: false,
    runState: { status: 'idle' } as never,
    sessionRuntimeRunning: {},
    workerLiveSnapshot: { status: 'idle' } as never,
    rewindTreeNodes: treeNodes,
    rewindLoadingTree: false,
    rewindTreeError: undefined,
    rewindKey: '/tmp/proj/s.jsonl',
  })
  vi.mocked(ipcClient.invoke).mockClear()
})

describe('tree click → view event → timeline reveal (end to end)', () => {
  it('single click on a user row scrolls the timeline to that message', async () => {
    const scrollIntoView = vi.fn()
    Element.prototype.scrollIntoView = scrollIntoView as unknown as (arg?: boolean | ScrollIntoViewOptions) => void
    const orig = Element.prototype.scrollIntoView
    try {
      render(<Timeline />)
      render(<TreePanel />)

      fireEvent.click(screenTreeRow('message-5'))
      await waitFor(() => expect(scrollIntoView).toHaveBeenCalled(), { timeout: 2000 })

      const target = scrollIntoView.mock.contexts[0] as HTMLElement
      expect(target?.dataset?.sessionEntryId).toBe('entry-5')
    } finally {
      Element.prototype.scrollIntoView = orig
    }
  })
})

function screenTreeRow(text: string): HTMLElement {
  const buttons = document.querySelectorAll('button')
  for (const b of buttons) {
    if ((b.textContent ?? '').trim() === text) return b as HTMLElement
  }
  throw new Error(`row not found: ${text}`)
}
