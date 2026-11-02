import { describe, expect, it } from 'vitest'
import type { SessionScopedAppEvent } from '@shared/app-event-session'
import { endsRetryWait } from '@renderer/stores/apply-app-event'
import { useUIStore } from '@renderer/stores/ui-store'
import { retryReasonLabel } from './composer-retry-banner'

const t = ((key: string, opts?: Record<string, unknown>) => (opts ? `${key}:${JSON.stringify(opts)}` : key)) as never

const base = { seq: 1, workspaceId: '/w', sessionFile: '/w/s.jsonl', timestamp: 1 }

describe('retry notice', () => {
  it('names the common transport failures', () => {
    expect(retryReasonLabel('Request timed out.', t)).toBe('composer:retry.reasonTimeout')
    expect(retryReasonLabel('Connection error.', t)).toBe('composer:retry.reasonConnection')
    expect(retryReasonLabel('524 {"title":"A timeout occurred"}', t)).toBe('composer:retry.reasonTimeout')
    expect(retryReasonLabel('520 {"title":"Web server is returning an unknown error"}', t)).toBe('composer:retry.reasonStatus:{"status":"520"}')
    expect(retryReasonLabel('', t)).toBe('composer:retry.reasonUnknown')
  })

  it('clears once the retried request makes progress or the run ends', () => {
    const ev = (e: object) => ({ ...base, ...e }) as SessionScopedAppEvent
    expect(endsRetryWait(ev({ type: 'message', role: 'assistant', phase: 'delta', text: 'x' }))).toBe(true)
    expect(endsRetryWait(ev({ type: 'tool', toolCallId: 't', toolName: 'read', phase: 'start' }))).toBe(true)
    expect(endsRetryWait(ev({ type: 'run', phase: 'idle' }))).toBe(true)
    expect(endsRetryWait(ev({ type: 'agent_error', text: 'boom' }))).toBe(true)
    // The retried request opening its message is not progress yet.
    expect(endsRetryWait(ev({ type: 'message', role: 'assistant', phase: 'start' }))).toBe(false)
    expect(endsRetryWait(ev({ type: 'run', phase: 'running' }))).toBe(false)
  })

  it('keys retry state by session file', () => {
    const info = { attempt: 1, maxAttempts: 3, errorMessage: 'Request timed out.', startedAt: 1, delayMs: 2000 }
    useUIStore.getState().setRetryingSession('/w/a.jsonl', info)
    expect(Object.values(useUIStore.getState().retryingSessions)).toEqual([info])
    useUIStore.getState().setRetryingSession('/w/b.jsonl', null)
    expect(Object.values(useUIStore.getState().retryingSessions)).toEqual([info])
    useUIStore.getState().setRetryingSession('/w/a.jsonl', null)
    expect(useUIStore.getState().retryingSessions).toEqual({})
  })
})
