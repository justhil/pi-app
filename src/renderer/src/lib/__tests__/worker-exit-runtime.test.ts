import { describe, expect, it, vi } from 'vitest'
import { clearExitedSessionRuntime } from '../worker-exit-runtime'

describe('clearExitedSessionRuntime', () => {
  it('clears the exited session running and compaction projections', () => {
    const setSessionRuntimeRunning = vi.fn()
    const setCompactingSession = vi.fn()

    clearExitedSessionRuntime(
      { code: 17, cwd: '/workspace', sessionFile: '/workspace/session.jsonl' },
      setSessionRuntimeRunning,
      setCompactingSession,
    )

    expect(setSessionRuntimeRunning).toHaveBeenCalledOnce()
    expect(setSessionRuntimeRunning).toHaveBeenCalledWith('/workspace/session.jsonl', false)
    expect(setCompactingSession).toHaveBeenCalledOnce()
    expect(setCompactingSession).toHaveBeenCalledWith('/workspace/session.jsonl', false)
  })

  it('does nothing when the exited worker was not bound to a session', () => {
    const setSessionRuntimeRunning = vi.fn()
    const setCompactingSession = vi.fn()

    clearExitedSessionRuntime(
      { code: 0, cwd: '/workspace', sessionFile: null },
      setSessionRuntimeRunning,
      setCompactingSession,
    )

    expect(setSessionRuntimeRunning).not.toHaveBeenCalled()
    expect(setCompactingSession).not.toHaveBeenCalled()
  })
})
