import { describe, expect, it } from 'vitest'
import {
  RECENT_ACTIVE_WINDOW_MS,
  buildActiveDrawerEntries,
  countAttention,
  pruneExpiredRecentSessions,
  reduceSessionAttention,
  selectSessionAttention,
} from '../session-attention'

describe('reduceSessionAttention', () => {
  it('maps waiting UI over running to needs-you', () => {
    expect(
      reduceSessionAttention({
        running: true,
        waitingUi: true,
        settledUnseen: true,
        viewing: false,
      }),
    ).toBe('needs-you')
  })

  it('maps running without waiting to working', () => {
    expect(
      reduceSessionAttention({
        running: true,
        waitingUi: false,
        settledUnseen: false,
        viewing: false,
      }),
    ).toBe('working')
  })

  it('maps settled unseen to done', () => {
    expect(
      reduceSessionAttention({
        running: false,
        waitingUi: false,
        settledUnseen: true,
        viewing: false,
      }),
    ).toBe('done')
  })

  it('clears done when the session is the current view', () => {
    expect(
      reduceSessionAttention({
        running: false,
        waitingUi: false,
        settledUnseen: true,
        viewing: true,
      }),
    ).toBe('idle')
  })

  it('keeps confirm/input/select/image as waiting when waitingUi is set', () => {
    expect(
      reduceSessionAttention({
        running: false,
        waitingUi: true,
        settledUnseen: false,
        viewing: false,
      }),
    ).toBe('needs-you')
  })
})

describe('selectSessionAttention', () => {
  it('matches mixed path separators', () => {
    expect(
      selectSessionAttention('C:\\s\\a.jsonl', { 'C:/s/a.jsonl': 'working' }),
    ).toBe('working')
  })
})

describe('countAttention', () => {
  it('counts working and needs-you separately', () => {
    expect(
      countAttention({
        a: 'working',
        b: 'needs-you',
        c: 'done',
        d: 'idle',
      }),
    ).toEqual({ working: 1, needsYou: 1, done: 1 })
  })
})

describe('buildActiveDrawerEntries & pruneExpiredRecentSessions', () => {
  it('includes running, needs-you, unread done, and sessions active within the last 1h while dropping >1h idle ones', () => {
    const now = 10_000_000
    const entries = buildActiveDrawerEntries({
      attention: {
        '/s/work.jsonl': 'working',
        '/s/wait.jsonl': 'needs-you',
        '/s/unread.jsonl': 'done',
      },
      recentActiveAt: {
        '/s/work.jsonl': now - 5_000,
        '/s/unread.jsonl': now - 120_000,
        '/s/read-recent.jsonl': now - 60_000,
        '/s/expired.jsonl': now - RECENT_ACTIVE_WINDOW_MS - 1,
      },
      now,
    })

    expect(entries.map((e) => [e.sessionFile, e.attention])).toEqual([
      ['/s/wait.jsonl', 'needs-you'],
      ['/s/work.jsonl', 'working'],
      ['/s/read-recent.jsonl', 'idle'],
      ['/s/unread.jsonl', 'done'],
    ])
  })

  it('keeps row order stable when an unread done session is clicked and becomes idle', () => {
    const now = 10_000_000
    const recentActiveAt = {
      '/s/first.jsonl': now - 30_000,
      '/s/second.jsonl': now - 90_000,
    }
    const beforeClick = buildActiveDrawerEntries({
      attention: { '/s/first.jsonl': 'done', '/s/second.jsonl': 'done' },
      recentActiveAt,
      now,
    })
    const afterClickingFirst = buildActiveDrawerEntries({
      attention: { '/s/second.jsonl': 'done' },
      recentActiveAt,
      now,
    })

    expect(beforeClick.map((e) => e.sessionFile)).toEqual(['/s/first.jsonl', '/s/second.jsonl'])
    expect(afterClickingFirst.map((e) => e.sessionFile)).toEqual(['/s/first.jsonl', '/s/second.jsonl'])
    expect(afterClickingFirst[0].attention).toBe('idle')
  })

  it('prunes timestamps older than 1 hour', () => {
    const now = 10_000_000
    expect(
      pruneExpiredRecentSessions(
        {
          '/s/fresh.jsonl': now - 1000,
          '/s/stale.jsonl': now - RECENT_ACTIVE_WINDOW_MS - 10,
        },
        now,
      ),
    ).toEqual({ '/s/fresh.jsonl': now - 1000 })
  })
})
