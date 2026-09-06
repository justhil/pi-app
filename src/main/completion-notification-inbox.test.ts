import { describe, expect, it, vi } from 'vitest'
import { createCompletionNotificationController } from './completion-notification-controller'
import type { CompletionEvent } from '@shared/app-events'

function event(partial: Partial<CompletionEvent> = {}): CompletionEvent {
  return {
    type: 'completion',
    outcome: 'success',
    settled: true,
    promptPreview: 'hi',
    responsePreview: 'done',
    durationMs: 10,
    seq: 1,
    workspaceId: '/w',
    sessionId: 's',
    sessionFile: '/w/a.jsonl',
    runId: 'r1',
    timestamp: 1,
    ...partial,
  }
}

describe('completion inbox', () => {
  it('keeps delivered cards for later review', () => {
    vi.useFakeTimers()
    const delivered: unknown[] = []
    const ctrl = createCompletionNotificationController({
      now: () => Date.now(),
      delayMs: 0,
      getSettings: () => ({
        soundEnabled: true,
        notificationEnabled: true,
        alertOnRunIdle: true,
        alertOnBackgroundRunIdle: true,
        alertOnRunFailed: true,
        alertOnCancelled: false,
        timeoutSeconds: 15,
        previewMode: 'response',
        onlyWhenUnfocused: false,
        dndUntil: null,
        delivery: 'custom',
        language: 'zh',
      }),
      getWindowState: () => ({ focused: false, visible: true, minimized: false }),
      getVisibleSessionFile: () => null,
      projectLabel: () => 'proj',
      deliver: (card) => delivered.push(card),
    })
    ctrl.handleCompletion(event())
    vi.runAllTimers()
    expect(ctrl.listInbox()).toHaveLength(1)
    expect(ctrl.listInbox()[0].unread).toBe(true)
    ctrl.markInboxRead(ctrl.listInbox()[0].notificationId)
    expect(ctrl.listInbox()[0].unread).toBe(false)
    vi.useRealTimers()
  })
})
