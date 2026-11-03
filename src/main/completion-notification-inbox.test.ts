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

function makeController(win: { focused: boolean; visible: boolean; minimized: boolean }, visible: { file: string | null }) {
  return createCompletionNotificationController({
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
    getWindowState: () => win,
    getVisibleSessionFile: () => visible.file,
    projectLabel: () => 'proj',
    deliver: () => undefined,
  })
}

describe('completion inbox auto-read', () => {
  it('reads the rows of a session when the user opens that conversation', () => {
    vi.useFakeTimers()
    const win = { focused: true, visible: true, minimized: false }
    const visible = { file: '/w/other.jsonl' as string | null }
    const ctrl = makeController(win, visible)
    ctrl.handleCompletion(event({ sessionFile: '/w/a.jsonl', runId: 'r1' }))
    ctrl.handleCompletion(event({ sessionFile: '/w/b.jsonl', runId: 'r2' }))
    vi.runAllTimers()
    expect(ctrl.listInbox().map((c) => c.unread)).toEqual([true, true])

    visible.file = '/w/a.jsonl'
    ctrl.notifyVisibleSessionChanged('/w/a.jsonl')
    const bySession = Object.fromEntries(ctrl.listInbox().map((c) => [c.sessionFile, c.unread]))
    expect(bySession).toEqual({ '/w/a.jsonl': false, '/w/b.jsonl': true })
    vi.useRealTimers()
  })

  it('waits for the window to come back to the front', () => {
    vi.useFakeTimers()
    const win = { focused: false, visible: true, minimized: false }
    const visible = { file: '/w/a.jsonl' as string | null }
    const ctrl = makeController(win, visible)
    ctrl.handleCompletion(event({ sessionFile: '/w/a.jsonl' }))
    vi.runAllTimers()
    expect(ctrl.listInbox()[0].unread).toBe(true)

    ctrl.notifyVisibleSessionChanged('/w/a.jsonl')
    expect(ctrl.listInbox()[0].unread).toBe(true)
    win.focused = true
    ctrl.notifyVisibleSessionChanged('/w/a.jsonl')
    expect(ctrl.listInbox()[0].unread).toBe(false)
    vi.useRealTimers()
  })

  it('files a completion of the conversation on screen as already read', () => {
    vi.useFakeTimers()
    const ctrl = makeController({ focused: true, visible: true, minimized: false }, { file: '/w/a.jsonl' })
    ctrl.handleCompletion(event({ sessionFile: '/w/a.jsonl' }))
    vi.runAllTimers()
    expect(ctrl.listInbox()[0].unread).toBe(false)
    vi.useRealTimers()
  })
})

describe('completion inbox with default alert settings', () => {
  // Defaults: no popup for background runs, popups only while the app is not in front.
  function defaults(win: { focused: boolean; visible: boolean; minimized: boolean }, visible: { file: string | null }, extra: { dndUntil?: number | null } = {}) {
    const delivered: unknown[] = []
    const ctrl = createCompletionNotificationController({
      now: () => Date.now(),
      delayMs: 2000,
      getSettings: () => ({
        soundEnabled: true,
        notificationEnabled: true,
        alertOnRunIdle: true,
        alertOnBackgroundRunIdle: false,
        alertOnRunFailed: true,
        alertOnCancelled: false,
        timeoutSeconds: 15,
        previewMode: 'response',
        onlyWhenUnfocused: true,
        dndUntil: extra.dndUntil ?? null,
        delivery: 'custom',
        language: 'zh',
      }),
      getWindowState: () => win,
      getVisibleSessionFile: () => visible.file,
      projectLabel: () => 'proj',
      deliver: (card) => delivered.push(card),
    })
    return { ctrl, delivered }
  }

  it('files a background completion as unread without a popup', () => {
    vi.useFakeTimers()
    const { ctrl, delivered } = defaults({ focused: true, visible: true, minimized: false }, { file: '/w/other.jsonl' })
    ctrl.handleCompletion(event({ sessionFile: '/w/a.jsonl' }))
    vi.advanceTimersByTime(2000)
    expect(delivered).toHaveLength(0)
    expect(ctrl.listInbox().map((c) => [c.sessionFile, c.unread])).toEqual([['/w/a.jsonl', true]])
    vi.useRealTimers()
  })

  it('files the conversation on screen as read and a muted one without a popup', () => {
    vi.useFakeTimers()
    const onScreen = defaults({ focused: true, visible: true, minimized: false }, { file: '/w/a.jsonl' })
    onScreen.ctrl.handleCompletion(event({ sessionFile: '/w/a.jsonl' }))
    vi.advanceTimersByTime(2000)
    expect(onScreen.delivered).toHaveLength(0)
    expect(onScreen.ctrl.listInbox()[0]?.unread).toBe(false)

    const muted = defaults({ focused: false, visible: true, minimized: false }, { file: '/w/a.jsonl' }, { dndUntil: Date.now() + 60_000 })
    muted.ctrl.handleCompletion(event({ sessionFile: '/w/a.jsonl', runId: 'r2' }))
    vi.advanceTimersByTime(2000)
    expect(muted.delivered).toHaveLength(0)
    expect(muted.ctrl.listInbox()[0]?.unread).toBe(true)
    vi.useRealTimers()
  })

  it('keeps a card the user opened during the grace delay, read and without a popup', () => {
    vi.useFakeTimers()
    const win = { focused: false, visible: true, minimized: false }
    const visible = { file: '/w/other.jsonl' as string | null }
    const { ctrl, delivered } = defaults(win, visible)
    ctrl.handleCompletion(event({ sessionFile: '/w/a.jsonl' }))
    win.focused = true
    visible.file = '/w/a.jsonl'
    ctrl.notifyVisibleSessionChanged('/w/a.jsonl')
    vi.advanceTimersByTime(2000)
    expect(delivered).toHaveLength(0)
    expect(ctrl.listInbox().map((c) => c.unread)).toEqual([false])
    vi.useRealTimers()
  })

  it('leaves cancelled runs out entirely', () => {
    vi.useFakeTimers()
    const { ctrl } = defaults({ focused: false, visible: true, minimized: false }, { file: null })
    ctrl.handleCompletion(event({ outcome: 'cancelled' }))
    vi.advanceTimersByTime(2000)
    expect(ctrl.listInbox()).toHaveLength(0)
    vi.useRealTimers()
  })
})
