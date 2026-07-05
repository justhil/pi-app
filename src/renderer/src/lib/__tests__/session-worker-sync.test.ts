import { beforeEach, describe, it, expect } from 'vitest'
import { clearAbortUiHold, markAbortUiHold } from '../abort-ui-hold'
import {
  canAbortWorkerTurn,
  isSessionPreviewComposeLocked,
  isViewingDifferentSessionThanWorker,
  normalizeWorkerLiveSnapshotForView,
  syncViewRunStateFromWorkerSnapshot,
} from '../session-worker-sync'

describe('session-worker-sync', () => {
  beforeEach(() => {
    clearAbortUiHold()
  })

  it('locks compose when previewing another session while worker is running', () => {
    expect(
      isSessionPreviewComposeLocked('/view/session.jsonl', '/worker/session.jsonl', 'running'),
    ).toBe(true)
    expect(
      isSessionPreviewComposeLocked('/same/session.jsonl', '/same/session.jsonl', 'running'),
    ).toBe(false)
    expect(
      isSessionPreviewComposeLocked('/view/session.jsonl', '/worker/session.jsonl', 'idle'),
    ).toBe(false)
  })

  it('detects view vs worker session mismatch', () => {
    expect(isViewingDifferentSessionThanWorker('a.jsonl', 'b.jsonl')).toBe(true)
    expect(isViewingDifferentSessionThanWorker('a.jsonl', 'a.jsonl')).toBe(false)
    expect(isViewingDifferentSessionThanWorker(null, 'a.jsonl')).toBe(false)
  })

  it('allows abort only for the visible worker-bound running session', () => {
    expect(canAbortWorkerTurn('/a.jsonl', { sessionId: 's1', sessionFile: '/a.jsonl', status: 'running' })).toBe(true)
    expect(canAbortWorkerTurn('/b.jsonl', { sessionId: 's1', sessionFile: '/a.jsonl', status: 'running' })).toBe(false)
    expect(canAbortWorkerTurn('/a.jsonl', { sessionId: 's1', sessionFile: '/a.jsonl', status: 'idle' })).toBe(false)
    expect(canAbortWorkerTurn('/a.jsonl', { sessionId: null, sessionFile: null, status: 'idle' }, true)).toBe(true)
    expect(canAbortWorkerTurn('/b.jsonl', { sessionId: 's1', sessionFile: '/a.jsonl', status: 'idle' }, true)).toBe(false)
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
})