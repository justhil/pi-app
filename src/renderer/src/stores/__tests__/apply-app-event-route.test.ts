import { describe, expect, it } from 'vitest'
import { resolveAppEventRoute } from '../apply-app-event-route'

const baseState = {
  currentWorkspace: '/w/preview',
  currentSessionId: 'view-sid',
  historySessionFile: '/tmp/preview.jsonl',
  workerLiveSnapshot: { sessionId: null, sessionFile: '/tmp/live.jsonl' },
}

describe('resolveAppEventRoute', () => {
  it('routes background deltas by sessionFile without sessionId', () => {
    expect(
      resolveAppEventRoute(baseState, {
        type: 'message',
        role: 'assistant',
        phase: 'delta',
        text: 'x',
        seq: 1,
        workspaceId: '/w/preview',
        sessionFile: '/tmp/live.jsonl',
        timestamp: 1,
      }),
    ).toBe('background')
  })

  it('keeps visible events on the viewed session file', () => {
    expect(
      resolveAppEventRoute(baseState, {
        type: 'message',
        role: 'assistant',
        phase: 'delta',
        text: 'x',
        seq: 1,
        workspaceId: '/w/preview',
        sessionFile: '/tmp/preview.jsonl',
        sessionId: 'view-sid',
        timestamp: 1,
      }),
    ).toBe('visible')
  })

  it('routes worker-bound events as visible when viewFile is null (first send)', () => {
    expect(
      resolveAppEventRoute(
        {
          currentWorkspace: '/w/preview',
          currentSessionId: 'view-sid',
          historySessionFile: null,
          workerLiveSnapshot: { sessionId: 'w-sid', sessionFile: '/tmp/live.jsonl' },
        },
        {
          type: 'message',
          role: 'assistant',
          phase: 'delta',
          text: 'first token',
          seq: 1,
          workspaceId: '/w/preview',
          sessionFile: '/tmp/live.jsonl',
          sessionId: 'w-sid',
          timestamp: 1,
        },
      ),
    ).toBe('visible')
  })

  it('backgrounds events from another workspace', () => {
    expect(
      resolveAppEventRoute(
        {
          currentWorkspace: '/w/a',
          currentSessionId: 'view-sid',
          historySessionFile: '/tmp/a.jsonl',
          workerLiveSnapshot: { sessionId: 'w-sid', sessionFile: '/tmp/b.jsonl' },
        },
        {
          type: 'message',
          role: 'assistant',
          phase: 'delta',
          text: 'x',
          seq: 1,
          workspaceId: '/w/b',
          sessionFile: '/tmp/b.jsonl',
          timestamp: 1,
        },
      ),
    ).toBe('background')
  })

  it('does not drop worker-bound events when viewFile differs but workerFile matches', () => {
    expect(
      resolveAppEventRoute(
        {
          currentWorkspace: '/w/preview',
          currentSessionId: 'view-sid',
          historySessionFile: '/tmp/other.jsonl',
          workerLiveSnapshot: { sessionId: 'w-sid', sessionFile: '/tmp/live.jsonl' },
        },
        {
          type: 'message',
          role: 'assistant',
          phase: 'delta',
          text: 'x',
          seq: 1,
          workspaceId: '/w/preview',
          sessionFile: '/tmp/live.jsonl',
          sessionId: 'w-sid',
          timestamp: 1,
        },
      ),
    ).toBe('background')
  })

  it('backgrounds unscoped events when view and worker session files differ', () => {
    expect(
      resolveAppEventRoute(
        {
          currentWorkspace: '/w/preview',
          currentSessionId: 'view-b',
          historySessionFile: '/tmp/b.jsonl',
          workerLiveSnapshot: { sessionId: 'w-a', sessionFile: '/tmp/a.jsonl' },
        },
        {
          type: 'run',
          phase: 'running',
          seq: 1,
          workspaceId: '/w/preview',
          timestamp: 1,
        } as never,
      ),
    ).toBe('background')
  })
})