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
      }),
    ).toBe(true)

    expect(
      composerTurnActive({
        historySessionFile: '/b.jsonl',
        workerLiveSnapshot: { sessionId: 's1', sessionFile: '/a.jsonl', status: 'running' },
        sessionRuntimeRunning: { '/a.jsonl': true },
      }),
    ).toBe(false)

    expect(
      composerTurnActive({
        historySessionFile: '/b.jsonl',
        workerLiveSnapshot: { sessionId: 's2', sessionFile: '/b.jsonl', status: 'idle' },
        sessionRuntimeRunning: { '/b.jsonl': true },
      }),
    ).toBe(true)

    expect(
      composerTurnActive({
        historySessionFile: '/a.jsonl',
        workerLiveSnapshot: { sessionId: 's1', sessionFile: '/a.jsonl', status: 'idle' },
      }),
    ).toBe(false)

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
    markAbortUiHold('/a.jsonl')
    expect(
      normalizeWorkerLiveSnapshotForView({ sessionId: 's1', sessionFile: '/a.jsonl', status: 'running' }).status,
    ).toBe('idle')
    expect(
      normalizeWorkerLiveSnapshotForView({ sessionId: 's2', sessionFile: '/b.jsonl', status: 'running' }).status,
    ).toBe('running')
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
        reconcileSessionRuntimeIdle: (file) => {
          cleared.push(file)
        },
      },
    )
    expect(snap).toEqual({ sessionId: null, sessionFile: '/b.jsonl', status: 'idle' })
    expect(runStatus).toBeNull()
    // Foreign running snap: must not touch the view's runtime map.
    expect(cleared).toEqual([])
  })

  it('fetchWorkerLiveSnapshot reports unknown (not idle) when IPC fails', async () => {
    vi.mocked(ipcClient.invoke).mockRejectedValue(new Error('ipc down'))
    const snap = await fetchWorkerLiveSnapshot('/w', '/b.jsonl')
    expect(snap.status).toBe('unknown')
  })

  it('applyLiveSnapshotToView keeps old state when snapshot is unknown (failed query)', () => {
    // 查询失败不能清掉运行态，否则正在跑的任务会失去停止入口并停掉轮询
    let snap: { sessionId: string | null; sessionFile: string | null; status: string } | null = null
    const cleared: string[] = []
    applyLiveSnapshotToView(
      '/view.jsonl',
      { sessionId: null, sessionFile: '/view.jsonl', status: 'unknown' },
      {
        historySessionFile: '/view.jsonl',
        runState: { status: 'running', toolCount: 0, errorCount: 0 },
        setWorkerLiveSnapshot: (s) => {
          snap = s
        },
        setRunState: (p) => {
          void p
        },
        reconcileSessionRuntimeIdle: (file) => {
          cleared.push(file)
        },
      },
    )
    // 旧 snapshot 与运行态都保留
    expect(snap).toBeNull()
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
        reconcileSessionRuntimeIdle: (file) => {
          cleared.push(file)
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
        reconcileSessionRuntimeIdle: (file) => {
          cleared.push(file)
        },
      },
    )
    expect(cleared).toEqual([])
  })

  it('reconciles stale runtime UI when the bound worker is authoritatively idle', () => {
    const reconcileSessionRuntimeIdle = vi.fn()
    applyLiveSnapshotToView(
      '/b.jsonl',
      { sessionId: 's2', sessionFile: '/b.jsonl', status: 'idle' },
      {
        historySessionFile: '/b.jsonl',
        runState: { status: 'running', toolCount: 0, errorCount: 0 },
        setWorkerLiveSnapshot: vi.fn(),
        setRunState: vi.fn(),
        reconcileSessionRuntimeIdle,
      } as Parameters<typeof applyLiveSnapshotToView>[2],
    )

    expect(reconcileSessionRuntimeIdle).toHaveBeenCalledWith('/b.jsonl')
  })

  it('ignores an idle poll that races ahead of the first run event', () => {
    const setWorkerLiveSnapshot = vi.fn()
    const setRunState = vi.fn()
    const reconcileSessionRuntimeIdle = vi.fn()
    applyLiveSnapshotToView(
      '/b.jsonl',
      { sessionId: 's2', sessionFile: '/b.jsonl', status: 'idle' },
      {
        historySessionFile: '/b.jsonl',
        runState: { status: 'running', toolCount: 0, errorCount: 0 },
        agentTurnBootstrapping: true,
        setWorkerLiveSnapshot,
        setRunState,
        reconcileSessionRuntimeIdle,
      },
    )

    expect(setWorkerLiveSnapshot).not.toHaveBeenCalled()
    expect(setRunState).not.toHaveBeenCalled()
    expect(reconcileSessionRuntimeIdle).not.toHaveBeenCalled()
  })

})
