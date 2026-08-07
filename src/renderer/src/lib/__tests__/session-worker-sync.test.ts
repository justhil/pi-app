import { beforeEach, describe, it, expect, vi } from 'vitest'
import { clearAbortUiHold, markAbortUiHold } from '../abort-ui-hold'

vi.mock('@renderer/lib/ipc-client', () => ({
  ipcClient: {
    invoke: vi.fn(),
  },
}))

import { ipcClient } from '@renderer/lib/ipc-client'
import {
  canAbortWorkerTurn,
  composerTurnActive,
  isSessionPreviewComposeLocked,
  isViewingDifferentSessionThanWorker,
  normalizeWorkerLiveSnapshotForView,
  syncViewRunStateFromWorkerSnapshot,
  applyLiveSnapshotToView,
  fetchWorkerLiveSnapshot,
} from '../session-worker-sync'

describe('session-worker-sync', () => {
  beforeEach(() => {
    clearAbortUiHold()
    vi.mocked(ipcClient.invoke).mockReset()
  })

  it('does not lock compose for normal multi-session navigation', () => {
    expect(
      isSessionPreviewComposeLocked('/view/session.jsonl', '/worker/session.jsonl', 'running'),
    ).toBe(false)
  })

  it('should_lock_compose_when_viewing_a_subagent_preview', () => {
    expect(
      isSessionPreviewComposeLocked(
        '/view/subagent.jsonl',
        '/worker/parent.jsonl',
        'running',
        true,
      ),
    ).toBe(true)
  })

  it('detects view vs worker session mismatch', () => {
    expect(isViewingDifferentSessionThanWorker('a.jsonl', 'b.jsonl')).toBe(true)
    expect(isViewingDifferentSessionThanWorker('a.jsonl', 'a.jsonl')).toBe(false)
    expect(isViewingDifferentSessionThanWorker(null, 'a.jsonl')).toBe(false)
  })

  it('allows abort only for the visible session that is actually running', () => {
    expect(canAbortWorkerTurn('/a.jsonl', { sessionId: 's1', sessionFile: '/a.jsonl', status: 'running' })).toBe(true)
    expect(canAbortWorkerTurn('/b.jsonl', { sessionId: 's1', sessionFile: '/a.jsonl', status: 'running' })).toBe(false)
    expect(canAbortWorkerTurn('/b.jsonl', { sessionId: 's1', sessionFile: '/a.jsonl', status: 'running' }, true)).toBe(
      false,
    )
    expect(
      canAbortWorkerTurn('/b.jsonl', { sessionId: null, sessionFile: null, status: 'idle' }, false, {
        '/b.jsonl': true,
      }),
    ).toBe(true)
  })

  it('composerTurnActive is session-scoped (no foreign worker stop button)', () => {
    expect(
      composerTurnActive({
        historySessionFile: '/a.jsonl',
        workerLiveSnapshot: { sessionId: 's1', sessionFile: '/a.jsonl', status: 'running' },
        runState: { status: 'running' },
        streamingAssistantId: null,
        optimisticPendingUserText: null,
      }),
    ).toBe(true)

    expect(
      composerTurnActive({
        historySessionFile: '/b.jsonl',
        workerLiveSnapshot: { sessionId: 's1', sessionFile: '/a.jsonl', status: 'running' },
        runState: { status: 'running' },
        streamingAssistantId: null,
        optimisticPendingUserText: null,
        sessionRuntimeRunning: { '/a.jsonl': true },
      }),
    ).toBe(false)

    expect(
      composerTurnActive({
        historySessionFile: '/b.jsonl',
        workerLiveSnapshot: { sessionId: 's2', sessionFile: '/b.jsonl', status: 'idle' },
        runState: { status: 'idle' },
        streamingAssistantId: null,
        optimisticPendingUserText: null,
        sessionRuntimeRunning: { '/b.jsonl': true },
      }),
    ).toBe(true)

    expect(
      composerTurnActive({
        historySessionFile: '/a.jsonl',
        workerLiveSnapshot: { sessionId: 's1', sessionFile: '/a.jsonl', status: 'idle' },
        runState: { status: 'idle' },
        streamingAssistantId: null,
        optimisticPendingUserText: null,
      }),
    ).toBe(false)

    // residual global runState.running after switch to idle session — NEVER trust alone
    expect(
      composerTurnActive({
        historySessionFile: '/b.jsonl',
        workerLiveSnapshot: { sessionId: 's2', sessionFile: '/b.jsonl', status: 'idle' },
        runState: { status: 'running' },
        streamingAssistantId: null,
        optimisticPendingUserText: null,
        sessionRuntimeRunning: { '/a.jsonl': true },
      }),
    ).toBe(false)

    // residual runState + unscoped worker snap running — still false for idle view B
    expect(
      composerTurnActive({
        historySessionFile: '/b.jsonl',
        workerLiveSnapshot: { sessionId: null, sessionFile: null, status: 'running' },
        runState: { status: 'running' },
        streamingAssistantId: null,
        optimisticPendingUserText: null,
      }),
    ).toBe(false)

    // local streaming markers still count for current view
    expect(
      composerTurnActive({
        historySessionFile: '/b.jsonl',
        workerLiveSnapshot: { sessionId: 's2', sessionFile: '/b.jsonl', status: 'idle' },
        runState: { status: 'idle' },
        streamingAssistantId: 'opt-asst-2',
        optimisticPendingUserText: null,
      }),
    ).toBe(true)
  })

  it('fetchWorkerLiveSnapshot does not mark requested idle session as running from foreign reply', async () => {
    vi.mocked(ipcClient.invoke).mockResolvedValue({
      state: { sessionId: 'sA', sessionFile: '/a.jsonl', isStreaming: true },
    })
    const snap = await fetchWorkerLiveSnapshot('/w', '/b.jsonl')
    expect(snap).toEqual({
      sessionId: null,
      sessionFile: '/b.jsonl',
      status: 'idle',
    })
  })

  it('fetchWorkerLiveSnapshot keeps running when reply matches requested session', async () => {
    vi.mocked(ipcClient.invoke).mockResolvedValue({
      state: { sessionId: 'sB', sessionFile: '/b.jsonl', isStreaming: true },
    })
    const snap = await fetchWorkerLiveSnapshot('/w', '/b.jsonl')
    expect(snap.status).toBe('running')
    expect(snap.sessionFile).toBe('/b.jsonl')
  })

  it('keeps worker snapshot idle during abort hold', () => {
    markAbortUiHold()
    expect(
      normalizeWorkerLiveSnapshotForView({ sessionId: 's1', sessionFile: '/a.jsonl', status: 'running' }).status,
    ).toBe('idle')
  })

  it('syncs runState to running only when view matches worker file', () => {
    const patches: Array<{ status: string }> = []
    syncViewRunStateFromWorkerSnapshot(
      '/a.jsonl',
      { sessionId: 's1', sessionFile: '/a.jsonl', status: 'running' },
      (p) => patches.push(p),
    )
    expect(patches).toEqual([{ status: 'running', activeTool: undefined, activeToolStatus: undefined }])

    patches.length = 0
    syncViewRunStateFromWorkerSnapshot(
      '/b.jsonl',
      { sessionId: 's1', sessionFile: '/a.jsonl', status: 'running' },
      (p) => patches.push(p),
    )
    expect(patches).toEqual([])
  })

  it('applyLiveSnapshotToView ignores foreign session running snap', () => {
    let snap: { sessionId: string | null; sessionFile: string | null; status: string } | null = null
    let runStatus: string | null = null
    const cleared: string[] = []
    applyLiveSnapshotToView(
      '/b.jsonl',
      { sessionId: 's1', sessionFile: '/a.jsonl', status: 'running' },
      {
        historySessionFile: '/b.jsonl',
        runState: { status: 'idle', toolCount: 0, errorCount: 0 },
        setWorkerLiveSnapshot: (s) => {
          snap = s
        },
        setRunState: (p) => {
          runStatus = p.status ?? null
        },
        setSessionRuntimeRunning: (file, running) => {
          if (!running) cleared.push(file)
        },
      },
    )
    expect(snap).toEqual({ sessionId: null, sessionFile: '/b.jsonl', status: 'idle' })
    expect(runStatus).toBeNull()
    // Foreign running snap: must not touch the view's runtime map.
    expect(cleared).toEqual([])
  })

  it('applyLiveSnapshotToView clears stale runtime entry when the worker is idle', () => {
    // The run.idle AppEvent never arrived (or was routed as background), leaving
    // sessionRuntimeRunning[view] = true — the Composer Stop button stays lit even
    // though the turn finished. An idle worker snapshot must clear it.
    let snap: { sessionId: string | null; sessionFile: string | null; status: string } | null = null
    const cleared: string[] = []
    applyLiveSnapshotToView(
      '/view.jsonl',
      { sessionId: 's1', sessionFile: '/view.jsonl', status: 'idle' },
      {
        historySessionFile: '/view.jsonl',
        runState: { status: 'running', toolCount: 0, errorCount: 0 },
        setWorkerLiveSnapshot: (s) => {
          snap = s
        },
        setRunState: (p) => {
          void p
        },
        setSessionRuntimeRunning: (file, running) => {
          if (!running) cleared.push(file)
        },
      },
    )
    expect(snap).toEqual({ sessionId: 's1', sessionFile: '/view.jsonl', status: 'idle' })
    expect(cleared).toEqual(['/view.jsonl'])
  })

  it('applyLiveSnapshotToView keeps runtime entry when the worker snap is running', () => {
    const cleared: string[] = []
    applyLiveSnapshotToView(
      '/view.jsonl',
      { sessionId: 's1', sessionFile: '/view.jsonl', status: 'running' },
      {
        historySessionFile: '/view.jsonl',
        runState: { status: 'idle', toolCount: 0, errorCount: 0 },
        setWorkerLiveSnapshot: (s) => {
          void s
        },
        setRunState: (p) => {
          void p
        },
        setSessionRuntimeRunning: (file, running) => {
          if (!running) cleared.push(file)
        },
      },
    )
    expect(cleared).toEqual([])
  })
})
