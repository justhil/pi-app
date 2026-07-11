import { beforeEach, describe, it, expect } from 'vitest'
import { clearAbortUiHold, markAbortUiHold } from '../abort-ui-hold'
import { selectSessionChrome, type SessionChromeInput } from '../session-chrome'

function base(overrides: Partial<SessionChromeInput> = {}): SessionChromeInput {
  return {
    historySessionFile: '/a.jsonl',
    workerLiveSnapshot: { sessionId: 's1', sessionFile: '/a.jsonl', status: 'idle' },
    runState: { status: 'idle' },
    streamingAssistantId: null,
    optimisticPendingUserText: null,
    sessionRuntimeRunning: {},
    agentTurnBootstrapping: false,
    extensionDialogOpen: false,
    ...overrides,
  }
}

describe('selectSessionChrome', () => {
  beforeEach(() => {
    clearAbortUiHold()
  })

  it('returns idle when nothing is running', () => {
    const view = selectSessionChrome(base())
    expect(view.phase).toBe('idle')
    expect(view.canStop).toBe(false)
    expect(view.showSpinner).toBe(false)
  })

  it('lights Stop + spinner for viewed session runtime', () => {
    const view = selectSessionChrome(
      base({
        sessionRuntimeRunning: { '/a.jsonl': true },
        runState: { status: 'running', activeRunId: 'r1' },
      }),
    )
    expect(view.canStop).toBe(true)
    expect(view.showSpinner).toBe(true)
    expect(view.phase).not.toBe('idle')
  })

  it('does not light Stop for foreign session runtime', () => {
    const view = selectSessionChrome(
      base({
        historySessionFile: '/b.jsonl',
        workerLiveSnapshot: { sessionId: 's2', sessionFile: '/b.jsonl', status: 'idle' },
        sessionRuntimeRunning: { '/a.jsonl': true },
        runState: { status: 'running' },
      }),
    )
    expect(view.canStop).toBe(false)
    expect(view.showSpinner).toBe(false)
    expect(view.phase).toBe('idle')
  })

  it('maps activeTool to tool phase', () => {
    const view = selectSessionChrome(
      base({
        sessionRuntimeRunning: { '/a.jsonl': true },
        runState: { status: 'running', activeTool: 'bash', activeRunId: 'r1' },
      }),
    )
    expect(view.phase).toBe('tool')
    expect(view.activeToolName).toBe('bash')
    expect(view.statusLabelKey).toBe('run:status.toolRunning')
  })

  it('maps extension dialog + busy to waiting_ui', () => {
    const view = selectSessionChrome(
      base({
        sessionRuntimeRunning: { '/a.jsonl': true },
        runState: { status: 'running', activeRunId: 'r1' },
        extensionDialogOpen: true,
      }),
    )
    expect(view.phase).toBe('waiting_ui')
    expect(view.canStop).toBe(true)
  })

  it('maps abort hold to stopping even after local idle clear', () => {
    markAbortUiHold(5000)
    const view = selectSessionChrome(
      base({
        runState: { status: 'idle' },
        sessionRuntimeRunning: {},
      }),
    )
    expect(view.phase).toBe('stopping')
    expect(view.canStop).toBe(false)
    expect(view.showSpinner).toBe(true)
  })

  it('maps streaming assistant to streaming phase', () => {
    const view = selectSessionChrome(
      base({
        streamingAssistantId: 'a1',
        runState: { status: 'running', activeRunId: 'r1' },
      }),
    )
    expect(view.phase).toBe('streaming')
    expect(view.canStop).toBe(true)
  })

  it('maps bootstrap / optimistic-only to starting', () => {
    const view = selectSessionChrome(
      base({
        agentTurnBootstrapping: true,
        optimisticPendingUserText: 'hi',
        runState: { status: 'running' },
      }),
    )
    expect(view.phase).toBe('starting')
  })

  it('maps compacting and retrying overrides', () => {
    expect(
      selectSessionChrome(
        base({
          sessionRuntimeRunning: { '/a.jsonl': true },
          compacting: true,
        }),
      ).phase,
    ).toBe('compacting')
    expect(
      selectSessionChrome(
        base({
          sessionRuntimeRunning: { '/a.jsonl': true },
          retrying: true,
        }),
      ).phase,
    ).toBe('retrying')
  })

  it('maps failed when not turn-active', () => {
    const view = selectSessionChrome(
      base({
        runState: { status: 'failed' },
      }),
    )
    expect(view.phase).toBe('failed')
    expect(view.canStop).toBe(false)
  })
})
