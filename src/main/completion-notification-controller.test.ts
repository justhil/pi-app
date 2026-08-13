import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CompletionEvent } from '@shared/app-events'
import {
  createCompletionNotificationController,
  type CompletionDeliverer,
  type CompletionNotificationSettings,
} from './completion-notification-controller'

function settings(partial: Partial<CompletionNotificationSettings> = {}): CompletionNotificationSettings {
  return {
    soundEnabled: true,
    notificationEnabled: true,
    alertOnRunIdle: true,
    alertOnBackgroundRunIdle: true,
    alertOnRunFailed: true,
    alertOnCancelled: false,
    timeoutSeconds: 15,
    previewMode: 'response',
    onlyWhenUnfocused: true,
    dndUntil: null,
    delivery: 'custom',
    language: 'zh',
    ...partial,
  }
}

function event(partial: Partial<CompletionEvent> = {}): CompletionEvent {
  return {
    type: 'completion',
    outcome: 'success',
    settled: true,
    promptPreview: '修一下通知',
    responsePreview: '已经改好了',
    durationMs: 3200,
    seq: 1,
    workspaceId: 'D:/proj',
    sessionId: 'sid-1',
    sessionFile: 'D:/proj/session.jsonl',
    runId: 'run-1',
    timestamp: 1,
    ...partial,
  }
}

describe('completion notification controller', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-13T04:00:00.000Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  function setup(opts?: {
    settings?: Partial<CompletionNotificationSettings>
    focused?: boolean
    visible?: boolean
    minimized?: boolean
    visibleSessionFile?: string | null
  }) {
    const delivered: Parameters<CompletionDeliverer>[0][] = []
    const visible = { file: opts?.visibleSessionFile ?? null }
    const controller = createCompletionNotificationController({
      now: () => Date.now(),
      delayMs: 2000,
      getSettings: () => settings(opts?.settings),
      getWindowState: () => ({
        focused: opts?.focused ?? false,
        visible: opts?.visible ?? true,
        minimized: opts?.minimized ?? false,
      }),
      getVisibleSessionFile: () => visible.file,
      projectLabel: (workspaceId) => workspaceId.replace(/\\/g, '/').split('/').pop() || 'proj',
      deliver: (card) => {
        delivered.push(card)
      },
    })
    return { controller, delivered, visible }
  }

  it('does not notify cancelled by default and notifies success/failed once', () => {
    const { controller, delivered } = setup()
    controller.handleCompletion(event({ outcome: 'cancelled' }))
    controller.handleCompletion(event({ outcome: 'success' }))
    controller.handleCompletion(event({ outcome: 'success' }))
    controller.handleCompletion(event({ outcome: 'failed', runId: 'run-2' }))
    vi.advanceTimersByTime(2000)
    expect(delivered.map((card) => card.outcome)).toEqual(['success', 'failed'])
  })

  it('cancels a pending card when the same session starts a new run', () => {
    const { controller, delivered } = setup()
    controller.handleCompletion(event())
    controller.notifyRunStarted('D:/proj/session.jsonl', 'run-2')
    vi.advanceTimersByTime(2000)
    expect(delivered).toHaveLength(0)
  })

  it('cancels a pending card when the target session becomes visible', () => {
    const { controller, delivered, visible } = setup()
    controller.handleCompletion(event({ runId: 'run-3' }))
    visible.file = 'D:/proj/session.jsonl'
    controller.notifyVisibleSessionChanged('D:/proj/session.jsonl')
    vi.advanceTimersByTime(2000)
    expect(delivered).toHaveLength(0)
  })

  it('suppresses focused visible sessions and still allows background sessions', () => {
    const focused = setup({
      focused: true,
      visible: true,
      visibleSessionFile: 'D:/proj/session.jsonl',
    })
    focused.controller.handleCompletion(event())
    vi.advanceTimersByTime(2000)
    expect(focused.delivered).toHaveLength(0)

    const background = setup({
      focused: true,
      visible: true,
      visibleSessionFile: 'D:/proj/other.jsonl',
      settings: { alertOnBackgroundRunIdle: true },
    })
    background.controller.handleCompletion(event())
    vi.advanceTimersByTime(2000)
    expect(background.delivered).toHaveLength(1)
  })

  it('drops DND and late settled after worker-exit failure', () => {
    const muted = setup({
      settings: { dndUntil: Date.now() + 60_000 },
    })
    muted.controller.handleCompletion(event())
    vi.advanceTimersByTime(2000)
    expect(muted.delivered).toHaveLength(0)

    const crash = setup({ visibleSessionFile: 'D:/proj/session.jsonl' })
    crash.controller.handleWorkerExitFailure({
      workspaceId: 'D:/proj',
      sessionId: 'sid-1',
      sessionFile: 'D:/proj/session.jsonl',
    })
    vi.advanceTimersByTime(2000)
    expect(crash.delivered).toHaveLength(1)
    expect(crash.delivered[0]?.outcome).toBe('failed')
    crash.controller.handleCompletion(event({ runId: 'late' }))
    vi.advanceTimersByTime(2000)
    expect(crash.delivered).toHaveLength(1)
  })
})
