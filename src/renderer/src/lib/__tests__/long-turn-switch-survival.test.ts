import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildTimelinePageFromSessionFile } from '@shared/session-jsonl-timeline'

const historyMock = vi.hoisted(() => ({ fetch: vi.fn() }))
vi.mock('@renderer/lib/session-history', () => ({ fetchSessionHistoryTail: historyMock.fetch }))
vi.mock('@renderer/lib/ipc-client', () => ({ ipcClient: { invoke: vi.fn().mockResolvedValue({}) } }))
vi.mock('@renderer/lib/session-display-meta', () => ({ applyComposerDisplayMeta: vi.fn() }))

import { captureVisibleLiveSessionTimeline } from '../capture-live-session-timeline'
import { clearLiveSessionTimeline } from '../live-session-timeline-cache'
import { clearSessionDiskAuthoritative } from '../session-disk-authority'
import { clearSessionShellForTests, focusSessionSync, hydrateSessionView } from '../session-shell'
import { clearStreamPending } from '@renderer/stores/ui-store-stream'
import { useUIStore } from '@renderer/stores/ui-store'
import type { TimelineItem } from '@renderer/stores/ui-store-types'

let directory: string
let sessionFile: string

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'pi-long-turn-'))
  sessionFile = join(directory, 'session.jsonl')
  writeFileSync(sessionFile, JSON.stringify({ type: 'session', version: 3, id: 'a', cwd: directory }) + '\n')
  clearSessionShellForTests()
  clearLiveSessionTimeline()
  clearSessionDiskAuthoritative()
  clearStreamPending()
})
afterEach(() => rmSync(directory, { recursive: true, force: true }))

describe('long turn history across session switches', () => {
  it('uses the expanded source count to load older rows without overlap', async () => {
    const rows = Array.from({ length: 100 }, (_, index) => ({
      id: `row-${index}`, type: index === 0 || index === 8 ? 'user-message' : 'tool-call',
    }))
    const tail = await buildTimelinePageFromSessionFile(sessionFile, { limit: 80 }, () => rows)
    const older = await buildTimelinePageFromSessionFile(
      sessionFile, { limit: 80, offset: tail.items.length }, () => rows,
    )
    expect(tail.items).toEqual(rows.slice(8))
    expect([...older.items, ...tail.items]).toEqual(rows)
    expect(tail.totalCount).toBe(rows.length)
  })

  it('keeps the row limit when a timeline has no user messages', async () => {
    const rows = Array.from({ length: 100 }, (_, index) => ({ id: `row-${index}`, type: 'tool-call' }))
    const tail = await buildTimelinePageFromSessionFile(sessionFile, { limit: 80 }, () => rows)
    expect(tail.items).toEqual(rows.slice(-80))
  })

  it.each([false, true])('keeps the prompt and fresh output (finished in background: %s)', async (finished) => {
    const user: TimelineItem = {
      id: 'user', type: 'user-message', text: 'Run the checks', sessionEntryId: 'u1', timestamp: 1,
    }
    const disk: TimelineItem[] = [user, ...Array.from({ length: 90 }, (_, index): TimelineItem => ({
      id: `tool-${index}`, type: 'tool-call', toolCallId: `call-${index}`, toolName: 'read',
      toolPhase: 'end', sessionEntryId: `step-${index}`, timestamp: 2 + index,
    })), {
      id: 'answer', type: 'assistant-message', text: 'Checks complete', sessionEntryId: 'a1', timestamp: 100,
    }]
    historyMock.fetch.mockImplementation(async (_file, limit) => {
      const page = await buildTimelinePageFromSessionFile(sessionFile, { limit }, () => disk.map(row => ({ ...row })))
      return { ...page, sourceCount: page.items.length }
    })
    useUIStore.setState({
      currentWorkspace: directory, currentSessionId: 'a', historySessionFile: sessionFile,
      timelineItems: [user, { id: 'live', type: 'assistant-message', text: 'Working', timestamp: 2 }],
      historyTotalCount: 1, historyLoadedCount: 1, historyLoading: false,
      streamingAssistantId: 'live', optimisticPendingUserText: null, agentTurnBootstrapping: false,
      pendingSteering: [], pendingFollowUp: [], sessionRuntimeRunning: { [sessionFile]: true },
      runState: { status: 'running', toolCount: 0, errorCount: 0 },
      workerLiveSnapshot: { sessionId: 'a', sessionFile, status: 'running' },
    })
    captureVisibleLiveSessionTimeline()
    focusSessionSync('b', join(directory, 'other.jsonl'))
    if (finished) useUIStore.getState().processEvent({
      type: 'run', phase: 'idle', seq: 1, workspaceId: directory, sessionFile, timestamp: 101,
    })
    focusSessionSync('a', sessionFile)
    await hydrateSessionView(sessionFile, 'a')
    const state = useUIStore.getState()
    expect(state.timelineItems.filter(row => row.type === 'user-message')).toEqual([user])
    expect(state.timelineItems.at(-1)?.text).toBe('Checks complete')
    expect(state.historyLoadedCount).toBe(disk.length)
    captureVisibleLiveSessionTimeline()
    focusSessionSync('b', join(directory, 'other.jsonl'))
    focusSessionSync('a', sessionFile)
    expect(useUIStore.getState().timelineItems.find(row => row.id === user.id)?.text).toBe(user.text)
  })
})
