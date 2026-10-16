import { describe, expect, it } from 'vitest'
import { mergeLiveTimelineWithHistoryTail } from '../merge-live-history-timeline'
import type { TimelineItem } from '@renderer/stores/ui-store-types'

const history: TimelineItem[] = [
  { id: 'h1', type: 'user-message', text: 'older question', timestamp: 1 },
  { id: 'h2', type: 'assistant-message', text: 'older answer', timestamp: 2 },
  { id: 'h3', type: 'user-message', text: 'current question', timestamp: 3, sessionEntryId: 'u-current' },
  { id: 'h4', type: 'assistant-message', text: '', thinkingText: '', timestamp: 4 },
]

const liveTail: TimelineItem[] = [
  { id: 'l1', type: 'user-message', text: 'current question', timestamp: 3, sessionEntryId: 'u-current' },
  { id: 'l2', type: 'assistant-message', text: 'streaming partial', timestamp: 5 },
]

describe('mergeLiveTimelineWithHistoryTail', () => {
  it('prefers longer live assistant text over empty disk placeholder on same turn', () => {
    const histWithEmpty: TimelineItem[] = [
      { id: 'h3', type: 'user-message', text: 'current question', timestamp: 3, sessionEntryId: 'u-current' },
      { id: 'h4', type: 'assistant-message', text: '', timestamp: 4 },
    ]
    const liveWithText: TimelineItem[] = [
      { id: 'l1', type: 'user-message', text: 'current question', timestamp: 3, sessionEntryId: 'u-current' },
      { id: 'l2', type: 'assistant-message', text: 'already streamed paragraph', timestamp: 5 },
    ]
    const merged = mergeLiveTimelineWithHistoryTail(histWithEmpty, liveWithText)
    expect(merged.at(-1)?.text).toBe('already streamed paragraph')
  })

  it('keeps older history when live cache only captured the active tail', () => {
    const merged = mergeLiveTimelineWithHistoryTail(history, liveTail)
    expect(merged.map((i) => i.id)).toEqual(['h1', 'h2', 'h3', 'l2'])
    expect(merged.at(-1)?.text).toBe('streaming partial')
  })

  it('does not double history when live is a full-page capture of the same session', () => {
    const fullLive: TimelineItem[] = [
      { id: 'h1', type: 'user-message', text: 'older question', timestamp: 1 },
      { id: 'h2', type: 'assistant-message', text: 'older answer', timestamp: 2 },
      { id: 'h3', type: 'user-message', text: 'current question', timestamp: 3, sessionEntryId: 'u-current' },
      { id: 'l2', type: 'assistant-message', text: 'streaming partial', timestamp: 5 },
    ]
    const merged = mergeLiveTimelineWithHistoryTail(history, fullLive)
    const userCount = merged.filter((i) => i.type === 'user-message').length
    expect(userCount).toBe(2)
    expect(merged.filter((i) => i.text === 'older question')).toHaveLength(1)
    expect(merged.at(-1)?.text).toBe('streaming partial')
  })

  it('replaces a live prefix when a refresh starts at a persisted tool entry', () => {
    const tool: TimelineItem = {
      id: 'tool', type: 'tool-call', toolCallId: 'tc1', toolName: 'bash',
      toolPhase: 'end', sessionEntryId: 'tool-entry', timestamp: 3,
    }
    const stream: TimelineItem = {
      id: 'stream', type: 'assistant-message', text: 'still streaming', timestamp: 4,
    }
    const live: TimelineItem[] = [
      { id: 'foreign', type: 'assistant-message', text: 'other conversation', sessionEntryId: 'foreign-entry', timestamp: 1 },
      { id: 'user', type: 'user-message', text: 'current prompt', sessionEntryId: 'user-entry', timestamp: 2 },
      tool, stream,
    ]

    expect(mergeLiveTimelineWithHistoryTail([tool], live, [], { preserveLivePrefix: false }))
      .toEqual([tool, stream])
    // Switching views still retains legitimately loaded history before the disk tail.
    expect(mergeLiveTimelineWithHistoryTail([tool], live)).toEqual(live)
  })

  it('keeps tool calls from live tail instead of collapsing to assistant only', () => {
    const hist: TimelineItem[] = [
      { id: 'h1', type: 'user-message', text: 'do work', timestamp: 1, sessionEntryId: 'u1' },
      { id: 'h2', type: 'assistant-message', text: '', timestamp: 2 },
    ]
    const live: TimelineItem[] = [
      { id: 'l1', type: 'user-message', text: 'do work', timestamp: 1, sessionEntryId: 'u1' },
      { id: 't1', type: 'tool-call', toolCallId: 'tc1', toolName: 'bash', toolPhase: 'start', timestamp: 3 },
      { id: 'l2', type: 'assistant-message', text: 'done', timestamp: 4 },
    ]
    const merged = mergeLiveTimelineWithHistoryTail(hist, live)
    expect(merged.some((i) => i.type === 'tool-call' && i.toolCallId === 'tc1')).toBe(true)
    expect(merged.at(-1)?.text).toBe('done')
  })

  it('does not hist+live concat when users do not align', () => {
    const hist: TimelineItem[] = [
      { id: 'h1', type: 'user-message', text: 'a', timestamp: 1 },
      { id: 'h2', type: 'assistant-message', text: 'A', timestamp: 2 },
    ]
    const live: TimelineItem[] = [
      { id: 'l1', type: 'user-message', text: 'b', timestamp: 3 },
      { id: 'l2', type: 'assistant-message', text: 'B', timestamp: 4 },
    ]
    const merged = mergeLiveTimelineWithHistoryTail(hist, live)
    expect(merged.filter((i) => i.type === 'user-message')).toHaveLength(1)
  })

  it('does_not_align_identical_user_text_when_entry_ids_differ', () => {
    const hist: TimelineItem[] = [
      {
        id: 'h1',
        type: 'user-message',
        text: 'continue',
        timestamp: 1,
        sessionEntryId: 'entry-history',
      },
      { id: 'h2', type: 'assistant-message', text: 'history answer', timestamp: 2 },
    ]
    const live: TimelineItem[] = [
      {
        id: 'l1',
        type: 'user-message',
        text: 'continue',
        timestamp: 3,
        sessionEntryId: 'entry-live',
      },
      { id: 'l2', type: 'assistant-message', text: 'live answer', timestamp: 4 },
    ]

    const merged = mergeLiveTimelineWithHistoryTail(hist, live)

    expect(merged.map((item) => item.id)).toEqual(['h1', 'h2'])
  })

  it('keeps_adjacent_identical_user_text_when_entry_ids_differ', () => {
    const hist: TimelineItem[] = [
      {
        id: 'h1',
        type: 'user-message',
        text: 'continue',
        timestamp: 1,
        sessionEntryId: 'entry-1',
      },
      {
        id: 'h2',
        type: 'user-message',
        text: 'continue',
        timestamp: 2,
        sessionEntryId: 'entry-2',
      },
    ]

    const merged = mergeLiveTimelineWithHistoryTail(hist, [])

    expect(merged).toHaveLength(2)
    expect(merged.map((item) => item.sessionEntryId)).toEqual(['entry-1', 'entry-2'])
  })

  it('keeps multi-turn order: hist prefix + live streaming tail after same last user', () => {
    const hist: TimelineItem[] = [
      { id: 'h1', type: 'user-message', text: 'q1', timestamp: 1, sessionEntryId: 'u1' },
      { id: 'h2', type: 'assistant-message', text: 'a1', timestamp: 2, sessionEntryId: 'a1' },
      { id: 'h3', type: 'user-message', text: 'q2', timestamp: 3, sessionEntryId: 'u2' },
      { id: 'h4', type: 'assistant-message', text: 'a2 partial', timestamp: 4, sessionEntryId: 'a2' },
    ]
    const live: TimelineItem[] = [
      { id: 'l3', type: 'user-message', text: 'q2', timestamp: 3, sessionEntryId: 'u2' },
      {
        id: 't1',
        type: 'tool-call',
        toolCallId: 'tc1',
        toolName: 'bash',
        toolPhase: 'end',
        timestamp: 5,
      },
      { id: 'l4', type: 'assistant-message', text: 'a2 full after tool', timestamp: 6 },
    ]
    const merged = mergeLiveTimelineWithHistoryTail(hist, live)
    expect(merged.map((i) => i.type)).toEqual([
      'user-message',
      'assistant-message',
      'user-message',
      'tool-call',
      'assistant-message',
    ])
    expect(merged[0].text).toBe('q1')
    expect(merged[1].text).toBe('a1')
    expect(merged[2].text).toBe('q2')
    expect(merged.at(-1)?.text).toBe('a2 full after tool')
  })

  it('should_keep_disk_leaf_when_live_diverges_after_shared_user_entry', () => {
    const hist: TimelineItem[] = [
      { id: 'h-u1', type: 'user-message', text: 'q1', timestamp: 1, sessionEntryId: 'u1' },
      {
        id: 'h-a-new',
        type: 'assistant-message',
        text: 'current branch answer',
        timestamp: 2,
        sessionEntryId: 'a-new',
      },
    ]
    const live: TimelineItem[] = [
      { id: 'l-u1', type: 'user-message', text: 'q1', timestamp: 1, sessionEntryId: 'u1' },
      {
        id: 'l-a-old',
        type: 'assistant-message',
        text: 'stale branch answer',
        timestamp: 2,
        sessionEntryId: 'a-old',
      },
      { id: 'l-u2', type: 'user-message', text: 'q2', timestamp: 3, sessionEntryId: 'u2' },
      { id: 'l-a2', type: 'assistant-message', text: 'stale continuation', timestamp: 4 },
    ]

    const merged = mergeLiveTimelineWithHistoryTail(hist, live)

    expect(merged.map((item) => item.id)).toEqual(['h-u1', 'h-a-new'])
  })

  it('should_append_bounded_live_tail_when_trimmed_identity_chain_contains_disk_tip', () => {
    const hist: TimelineItem[] = [
      { id: 'h-u1', type: 'user-message', text: 'q1', timestamp: 1, sessionEntryId: 'u1' },
    ]
    const live: TimelineItem[] = [
      { id: 'l-u2', type: 'user-message', text: 'q2', timestamp: 3, sessionEntryId: 'u2' },
      { id: 'l-a2', type: 'assistant-message', text: 'active continuation', timestamp: 4 },
    ]

    const merged = mergeLiveTimelineWithHistoryTail(hist, live, ['u1', 'a1'])

    expect(merged.map((item) => item.id)).toEqual(['h-u1', 'l-u2', 'l-a2'])
  })

  it('should_keep_disk_leaf_when_trimmed_overlap_proves_branch_conflict', () => {
    const hist: TimelineItem[] = [
      { id: 'h-u1', type: 'user-message', text: 'q1', timestamp: 1, sessionEntryId: 'u1' },
      {
        id: 'h-a-new',
        type: 'assistant-message',
        text: 'current branch answer',
        timestamp: 2,
        sessionEntryId: 'a-new',
      },
    ]
    const live: TimelineItem[] = [
      { id: 'l-u2', type: 'user-message', text: 'q2', timestamp: 3, sessionEntryId: 'u2' },
      { id: 'l-a2', type: 'assistant-message', text: 'stale continuation', timestamp: 4 },
    ]

    const merged = mergeLiveTimelineWithHistoryTail(hist, live, ['u1', 'a-old'])

    expect(merged.map((item) => item.id)).toEqual(['h-u1', 'h-a-new'])
  })

  it('should_keep_disk_assistant_when_assistant_only_live_tail_has_different_run', () => {
    const hist: TimelineItem[] = [
      { id: 'h-u2', type: 'user-message', text: 'q2', sessionEntryId: 'u2', timestamp: 1 },
      {
        id: 'h-a2',
        type: 'assistant-message',
        text: 'current run partial',
        runId: 'run-2',
        timestamp: 2,
      },
    ]
    const live: TimelineItem[] = [
      {
        id: 'l-a1',
        type: 'assistant-message',
        text: 'stale previous run answer with much longer text',
        runId: 'run-1',
        timestamp: 3,
      },
    ]

    const merged = mergeLiveTimelineWithHistoryTail(hist, live)

    expect(merged).toEqual(hist)
  })

  it('should_enrich_assistant_only_live_tail_when_assistant_entry_id_matches', () => {
    const hist: TimelineItem[] = [
      { id: 'h-u2', type: 'user-message', text: 'q2', sessionEntryId: 'u2', timestamp: 1 },
      {
        id: 'h-a2',
        type: 'assistant-message',
        text: '',
        sessionEntryId: 'a2-entry',
        timestamp: 2,
      },
    ]
    const live: TimelineItem[] = [
      {
        id: 'l-a2',
        type: 'assistant-message',
        text: 'completed current answer',
        sessionEntryId: 'a2-entry',
        timestamp: 3,
      },
    ]

    const merged = mergeLiveTimelineWithHistoryTail(hist, live)

    expect(merged.at(-1)).toMatchObject({
      id: 'l-a2',
      text: 'completed current answer',
      sessionEntryId: 'a2-entry',
    })
  })

  it('should_enrich_assistant_only_live_tail_when_turn_id_matches', () => {
    const hist: TimelineItem[] = [
      {
        id: 'h-u2',
        type: 'user-message',
        text: 'q2',
        sessionEntryId: 'u2',
        turnId: 'turn-2',
        timestamp: 1,
      },
      {
        id: 'h-a2',
        type: 'assistant-message',
        text: 'partial',
        runId: 'run-shared',
        turnId: 'turn-2',
        timestamp: 2,
      },
    ]
    const live: TimelineItem[] = [
      {
        id: 'l-a2',
        type: 'assistant-message',
        text: 'partial and completed',
        runId: 'run-shared',
        turnId: 'turn-2',
        timestamp: 3,
      },
    ]

    const merged = mergeLiveTimelineWithHistoryTail(hist, live)

    expect(merged.at(-1)).toMatchObject({
      id: 'l-a2',
      text: 'partial and completed',
      turnId: 'turn-2',
    })
  })

  it('should_reject_same_run_assistant_and_tool_tail_from_different_turn', () => {
    const hist: TimelineItem[] = [
      {
        id: 'h-u2',
        type: 'user-message',
        text: 'q2',
        sessionEntryId: 'u2',
        turnId: 'turn-2',
        timestamp: 1,
      },
      {
        id: 'h-a2',
        type: 'assistant-message',
        text: 'current partial',
        runId: 'run-shared',
        turnId: 'turn-2',
        timestamp: 2,
      },
    ]
    const staleTail: TimelineItem[] = [
      {
        id: 'stale-a1',
        type: 'assistant-message',
        text: 'stale answer',
        runId: 'run-shared',
        turnId: 'turn-1',
        timestamp: 3,
      },
      {
        id: 'stale-tool-1',
        type: 'tool-call',
        toolCallId: 'stale-tool',
        toolName: 'read',
        toolPhase: 'end',
        runId: 'run-shared',
        turnId: 'turn-1',
        timestamp: 4,
      },
    ]

    expect(mergeLiveTimelineWithHistoryTail(hist, staleTail)).toEqual(hist)
  })
})
