import { beforeEach, describe, expect, it } from 'vitest'
import {
  applyBackgroundAppEventToLiveTimeline,
  BACKGROUND_LIVE_TIMELINE_MAX_ITEMS,
  clearLiveSessionTimeline,
  getLiveSessionTimeline,
  saveLiveSessionTimeline,
} from '../live-session-timeline-cache'
import type { TimelineItem } from '@renderer/stores/ui-store-types'

const baseItems: TimelineItem[] = [
  { id: 'u1', type: 'user-message', text: 'hello', timestamp: 1 },
  { id: 'a1', type: 'assistant-message', text: '', thinkingText: '', timestamp: 2 },
]

describe('live-session-timeline-cache', () => {
  beforeEach(() => {
    clearLiveSessionTimeline()
  })

  it('keeps streaming assistant text while session is viewed in background', () => {
    saveLiveSessionTimeline({
      sessionId: 's1',
      sessionFile: '/tmp/s1.jsonl',
      timelineItems: baseItems,
      streamingAssistantId: 'a1',
      runState: { status: 'running', toolCount: 0, errorCount: 0 },
      pendingSteering: [],
      pendingFollowUp: [],
      optimisticPendingUserText: null,
      agentTurnBootstrapping: false,
    })

    applyBackgroundAppEventToLiveTimeline('/tmp/s1.jsonl', {
      type: 'message',
      role: 'assistant',
      phase: 'delta',
      contentKind: 'text',
      text: 'partial reply',
      seq: 1,
      workspaceId: '/w',
      sessionId: 's1',
      timestamp: 3,
    })

    const snap = getLiveSessionTimeline('/tmp/s1.jsonl')
    expect(snap?.streamingAssistantId).toBe('a1')
    expect(snap?.timelineItems.at(-1)?.text).toBe('partial reply')
  })

  it('bootstraps background cache when capture was missed', () => {
    applyBackgroundAppEventToLiveTimeline('/tmp/s2.jsonl', {
      type: 'message',
      role: 'assistant',
      phase: 'delta',
      contentKind: 'text',
      text: 'late stream',
      seq: 3,
      workspaceId: '/w',
      sessionFile: '/tmp/s2.jsonl',
      timestamp: 5,
    })

    expect(getLiveSessionTimeline('/tmp/s2.jsonl')?.timelineItems.at(-1)?.text).toBe('late stream')
  })

  it('marks cached live turn idle when background run ends', () => {
    applyBackgroundAppEventToLiveTimeline('/tmp/s1.jsonl', {
      type: 'run',
      phase: 'idle',
      seq: 2,
      workspaceId: '/w',
      sessionId: 's1',
      timestamp: 4,
    })

    expect(getLiveSessionTimeline('/tmp/s1.jsonl')?.runState.status).toBe('idle')
  })

  it('should_flush_pending_assistant_delta_before_background_tool_start', () => {
    const sessionFile = '/tmp/background-tool-race.jsonl'
    saveLiveSessionTimeline({
      sessionId: 'session-1',
      sessionFile,
      timelineItems: [
        {
          id: 'assistant-1',
          type: 'assistant-message',
          text: '',
          thinkingText: '',
          timestamp: 1,
        },
      ],
      streamingAssistantId: 'assistant-1',
      runState: { status: 'running', toolCount: 0, errorCount: 0 },
      pendingSteering: [],
      pendingFollowUp: [],
      optimisticPendingUserText: null,
      agentTurnBootstrapping: false,
    })

    applyBackgroundAppEventToLiveTimeline(sessionFile, {
      type: 'message',
      role: 'assistant',
      phase: 'delta',
      contentKind: 'text',
      text: 'last chunk',
      seq: 1,
      workspaceId: '/workspace',
      sessionFile,
      timestamp: 2,
    })
    applyBackgroundAppEventToLiveTimeline(sessionFile, {
      type: 'tool',
      phase: 'start',
      toolCallId: 'tool-1',
      toolName: 'read',
      input: {},
      seq: 2,
      workspaceId: '/workspace',
      sessionFile,
      timestamp: 3,
    })

    const assistant = getLiveSessionTimeline(sessionFile)?.timelineItems.find(
      (item) => item.id === 'assistant-1',
    )
    expect(assistant?.text).toBe('last chunk')
  })

  it('routes concurrent same-name background tool updates by toolCallId', () => {
    const sessionFile = '/tmp/background-parallel-subagents.jsonl'
    for (const toolCallId of ['subagent-1', 'subagent-2']) {
      applyBackgroundAppEventToLiveTimeline(sessionFile, {
        type: 'tool',
        phase: 'start',
        toolCallId,
        toolName: 'subagent',
        input: {},
        seq: toolCallId === 'subagent-1' ? 1 : 2,
        workspaceId: '/workspace',
        sessionFile,
        timestamp: 3,
      })
    }

    const details = {
      mode: 'single',
      progress: [{ agent: 'scout', status: 'running', toolCount: 4 }],
    }
    applyBackgroundAppEventToLiveTimeline(sessionFile, {
      type: 'tool',
      phase: 'update',
      toolCallId: 'subagent-1',
      toolName: 'subagent',
      output: 'scout is working',
      details,
      seq: 3,
      workspaceId: '/workspace',
      sessionFile,
      timestamp: 4,
    })

    const tools = getLiveSessionTimeline(sessionFile)?.timelineItems.filter(
      (item) => item.type === 'tool-call',
    )
    expect(tools?.find((item) => item.toolCallId === 'subagent-1')).toMatchObject({
      toolPhase: 'update',
      toolStatusLine: 'scout is working',
      toolDetails: details,
    })
    expect(tools?.find((item) => item.toolCallId === 'subagent-2')).toMatchObject({
      toolPhase: 'start',
    })
  })

  it('should_add_delivered_queued_user_turn_to_background_timeline', () => {
    const sessionFile = '/tmp/background-queued-user.jsonl'
    saveLiveSessionTimeline({
      sessionId: 'session-1',
      sessionFile,
      timelineItems: [
        {
          id: 'user-1',
          type: 'user-message',
          text: 'first question',
          sessionEntryId: 'user-entry-1',
          timestamp: 1,
        },
        {
          id: 'assistant-1',
          type: 'assistant-message',
          text: 'first answer',
          sessionEntryId: 'assistant-entry-1',
          timestamp: 2,
        },
      ],
      streamingAssistantId: null,
      runState: { status: 'running', toolCount: 0, errorCount: 0 },
      pendingSteering: [],
      pendingFollowUp: [],
      optimisticPendingUserText: null,
      agentTurnBootstrapping: false,
    })

    applyBackgroundAppEventToLiveTimeline(sessionFile, {
      type: 'message',
      role: 'user',
      phase: 'start',
      text: 'queued follow-up',
      seq: 3,
      workspaceId: '/workspace',
      sessionFile,
      timestamp: 5,
    })
    applyBackgroundAppEventToLiveTimeline(sessionFile, {
      type: 'message',
      role: 'user',
      phase: 'end',
      sessionEntryId: 'user-entry-2',
      seq: 4,
      workspaceId: '/workspace',
      sessionFile,
      timestamp: 6,
    })

    const users = getLiveSessionTimeline(sessionFile)?.timelineItems.filter(
      (item) => item.type === 'user-message',
    )
    expect(users?.map((item) => [item.text, item.sessionEntryId])).toEqual([
      ['first question', 'user-entry-1'],
      ['queued follow-up', 'user-entry-2'],
    ])
  })

  it('should_preserve_repeated_background_delta_chunks', () => {
    const sessionFile = '/tmp/background-repeated-deltas.jsonl'
    saveLiveSessionTimeline({
      sessionId: 'session-1',
      sessionFile,
      timelineItems: [
        {
          id: 'assistant-1',
          type: 'assistant-message',
          text: '',
          thinkingText: '',
          timestamp: 1,
        },
      ],
      streamingAssistantId: 'assistant-1',
      runState: { status: 'running', toolCount: 0, errorCount: 0 },
      pendingSteering: [],
      pendingFollowUp: [],
      optimisticPendingUserText: null,
      agentTurnBootstrapping: false,
    })

    for (const sequence of [1, 2]) {
      applyBackgroundAppEventToLiveTimeline(sessionFile, {
        type: 'message',
        role: 'assistant',
        phase: 'delta',
        contentKind: 'text',
        text: 'ha',
        seq: sequence,
        workspaceId: '/workspace',
        sessionFile,
        timestamp: sequence + 1,
      })
    }

    expect(getLiveSessionTimeline(sessionFile)?.timelineItems.at(-1)?.text).toBe('haha')
  })

  it('should_keep_identical_persisted_background_user_turns_distinct', () => {
    const sessionFile = '/tmp/background-identical-users.jsonl'
    saveLiveSessionTimeline({
      sessionId: 'session-1',
      sessionFile,
      timelineItems: [
        {
          id: 'persisted-user-1',
          type: 'user-message',
          text: 'continue',
          sessionEntryId: 'entry-1',
          timestamp: 1,
        },
      ],
      streamingAssistantId: null,
      runState: { status: 'running', toolCount: 0, errorCount: 0 },
      pendingSteering: [],
      pendingFollowUp: [],
      optimisticPendingUserText: null,
      agentTurnBootstrapping: false,
    })

    applyBackgroundAppEventToLiveTimeline(sessionFile, {
      type: 'message',
      role: 'user',
      phase: 'start',
      text: 'continue',
      seq: 2,
      workspaceId: '/workspace',
      sessionFile,
      timestamp: 2,
    })

    expect(
      getLiveSessionTimeline(sessionFile)?.timelineItems.filter(
        (item) => item.type === 'user-message',
      ),
    ).toHaveLength(2)
  })

  it('should_not_reuse_stale_background_optimistic_id_without_pending_marker', () => {
    const sessionFile = '/tmp/background-stale-optimistic-user.jsonl'
    saveLiveSessionTimeline({
      sessionId: 'session-1',
      sessionFile,
      timelineItems: [
        {
          id: 'opt-user-stale',
          type: 'user-message',
          text: 'continue',
          sessionEntryId: 'entry-old',
          timestamp: 1,
        },
      ],
      streamingAssistantId: null,
      runState: { status: 'running', toolCount: 0, errorCount: 0 },
      pendingSteering: [],
      pendingFollowUp: [],
      optimisticPendingUserText: null,
      agentTurnBootstrapping: false,
    })

    applyBackgroundAppEventToLiveTimeline(sessionFile, {
      type: 'message',
      role: 'user',
      phase: 'start',
      text: 'continue',
      runId: 'run-1',
      seq: 2,
      workspaceId: '/workspace',
      sessionFile,
      timestamp: 2,
    })

    expect(
      getLiveSessionTimeline(sessionFile)?.timelineItems.filter(
        (item) => item.type === 'user-message',
      ),
    ).toHaveLength(2)
  })

  it('should_reuse_background_optimistic_user_row', () => {
    const sessionFile = '/tmp/background-optimistic-user.jsonl'
    saveLiveSessionTimeline({
      sessionId: 'session-1',
      sessionFile,
      timelineItems: [
        {
          id: 'opt-user-1',
          type: 'user-message',
          text: 'continue',
          timestamp: 1,
        },
      ],
      streamingAssistantId: null,
      runState: { status: 'running', toolCount: 0, errorCount: 0 },
      pendingSteering: [],
      pendingFollowUp: [],
      optimisticPendingUserText: 'continue',
      agentTurnBootstrapping: true,
    })

    applyBackgroundAppEventToLiveTimeline(sessionFile, {
      type: 'message',
      role: 'user',
      phase: 'start',
      text: 'continue',
      runId: 'run-1',
      seq: 2,
      workspaceId: '/workspace',
      sessionFile,
      timestamp: 2,
    })

    const snapshot = getLiveSessionTimeline(sessionFile)
    expect(snapshot?.timelineItems.filter((item) => item.type === 'user-message')).toHaveLength(1)
    expect(snapshot?.optimisticPendingUserText).toBeNull()
    expect(snapshot?.agentTurnBootstrapping).toBe(false)
  })

  it('should_trim_saved_snapshot_to_background_item_budget', () => {
    const sessionFile = '/tmp/large-live-snapshot.jsonl'
    const items: TimelineItem[] = Array.from(
      { length: BACKGROUND_LIVE_TIMELINE_MAX_ITEMS + 20 },
      (_, index) => ({
        id: `user-${index}`,
        type: 'user-message',
        text: `message ${index}`,
        timestamp: index,
      }),
    )

    saveLiveSessionTimeline({
      sessionId: 'session-1',
      sessionFile,
      timelineItems: items,
      streamingAssistantId: null,
      runState: { status: 'idle', toolCount: 0, errorCount: 0 },
      pendingSteering: [],
      pendingFollowUp: [],
      optimisticPendingUserText: null,
      agentTurnBootstrapping: false,
    })

    expect(getLiveSessionTimeline(sessionFile)?.timelineItems).toHaveLength(
      BACKGROUND_LIVE_TIMELINE_MAX_ITEMS,
    )
  })

  it('should_keep_fixed_persisted_overlap_when_background_items_are_trimmed', () => {
    const sessionFile = '/tmp/large-live-overlap.jsonl'
    const items: TimelineItem[] = Array.from(
      { length: BACKGROUND_LIVE_TIMELINE_MAX_ITEMS + 4 },
      (_, index) => ({
        id: `entry-${index}`,
        type: index % 2 === 0 ? 'user-message' : 'assistant-message',
        text: `message ${index}`,
        sessionEntryId: `persisted-${index}`,
        timestamp: index,
      }),
    ) as TimelineItem[]

    saveLiveSessionTimeline({
      sessionId: 'session-1',
      sessionFile,
      timelineItems: items,
      streamingAssistantId: null,
      runState: { status: 'running', toolCount: 0, errorCount: 0 },
      pendingSteering: [],
      pendingFollowUp: [],
      optimisticPendingUserText: null,
      agentTurnBootstrapping: false,
    })

    const snapshot = getLiveSessionTimeline(sessionFile)
    expect(snapshot?.timelineItems).toHaveLength(BACKGROUND_LIVE_TIMELINE_MAX_ITEMS)
    expect(snapshot?.persistedEntryOverlap).toEqual([
      'persisted-0',
      'persisted-1',
      'persisted-2',
      'persisted-3',
    ])
  })

  it('should_keep_ordered_branch_local_overlap_across_repeated_saves', () => {
    const sessionFile = '/tmp/repeated-live-overlap.jsonl'
    const firstItems = Array.from(
      { length: BACKGROUND_LIVE_TIMELINE_MAX_ITEMS + 2 },
      (_, index) => ({
        id: `first-${index}`,
        type: 'assistant-message' as const,
        text: `first ${index}`,
        sessionEntryId: `first-entry-${index}`,
        timestamp: index,
      }),
    )
    const first = {
      sessionId: 'session-1',
      sessionFile,
      timelineItems: firstItems,
      streamingAssistantId: null,
      runState: { status: 'running' as const, toolCount: 0, errorCount: 0 },
      pendingSteering: [],
      pendingFollowUp: [],
      optimisticPendingUserText: null,
      agentTurnBootstrapping: false,
    }
    saveLiveSessionTimeline(first)
    saveLiveSessionTimeline({ ...first, persistedEntryOverlap: ['caller-stale'] })

    expect(getLiveSessionTimeline(sessionFile)?.persistedEntryOverlap).toEqual([
      'first-entry-0',
      'first-entry-1',
    ])

    saveLiveSessionTimeline({
      ...first,
      timelineItems: [
        {
          id: 'branch-user',
          type: 'user-message',
          text: 'new branch',
          sessionEntryId: 'branch-user-entry',
          timestamp: 500,
        },
        {
          id: 'branch-assistant',
          type: 'assistant-message',
          text: 'new answer',
          sessionEntryId: 'branch-assistant-entry',
          timestamp: 501,
        },
      ],
      persistedEntryOverlap: ['branch-parent-entry'],
    })

    const branch = getLiveSessionTimeline(sessionFile)
    expect(branch?.timelineItems).toHaveLength(2)
    expect(branch?.persistedEntryOverlap).toEqual(['branch-parent-entry'])
  })

  it('should_replace_longer_cache_when_explicit_overlap_marks_strict_prefix_branch_change', () => {
    const sessionFile = '/tmp/strict-prefix-branch.jsonl'
    saveLiveSessionTimeline({
      sessionId: 'session-1',
      sessionFile,
      timelineItems: [
        { id: 'old-u1', type: 'user-message', text: 'q1', sessionEntryId: 'u1', timestamp: 1 },
        { id: 'old-a1', type: 'assistant-message', text: 'a1', sessionEntryId: 'a1', timestamp: 2 },
        { id: 'old-u2', type: 'user-message', text: 'q2', sessionEntryId: 'u2', timestamp: 3 },
        { id: 'old-a2', type: 'assistant-message', text: 'old branch', sessionEntryId: 'a2', timestamp: 4 },
      ],
      persistedEntryOverlap: ['parent-old'],
      streamingAssistantId: null,
      runState: { status: 'idle', toolCount: 0, errorCount: 0 },
      pendingSteering: [],
      pendingFollowUp: [],
      optimisticPendingUserText: null,
      agentTurnBootstrapping: false,
    })

    saveLiveSessionTimeline({
      sessionId: 'session-1',
      sessionFile,
      timelineItems: [
        { id: 'new-u1', type: 'user-message', text: 'q1', sessionEntryId: 'u1', timestamp: 1 },
        { id: 'new-a1', type: 'assistant-message', text: 'a1', sessionEntryId: 'a1', timestamp: 2 },
      ],
      persistedEntryOverlap: ['parent-new'],
      streamingAssistantId: null,
      runState: { status: 'idle', toolCount: 0, errorCount: 0 },
      pendingSteering: [],
      pendingFollowUp: [],
      optimisticPendingUserText: null,
      agentTurnBootstrapping: false,
    })

    const snapshot = getLiveSessionTimeline(sessionFile)
    expect(snapshot?.timelineItems.map((item) => item.id)).toEqual(['new-u1', 'new-a1'])
    expect(snapshot?.persistedEntryOverlap).toEqual(['parent-new'])
  })

  it('should_replace_cache_when_persisted_identities_are_disjoint', () => {
    const sessionFile = '/tmp/disjoint-branch.jsonl'
    saveLiveSessionTimeline({
      sessionId: 'session-1',
      sessionFile,
      timelineItems: [
        { id: 'old-u1', type: 'user-message', text: 'old q1', sessionEntryId: 'old-u1', timestamp: 1 },
        { id: 'old-a1', type: 'assistant-message', text: 'old a1', sessionEntryId: 'old-a1', timestamp: 2 },
        { id: 'old-u2', type: 'user-message', text: 'old q2', sessionEntryId: 'old-u2', timestamp: 3 },
        { id: 'old-a2', type: 'assistant-message', text: 'old a2', sessionEntryId: 'old-a2', timestamp: 4 },
      ],
      streamingAssistantId: null,
      runState: { status: 'idle', toolCount: 0, errorCount: 0 },
      pendingSteering: [],
      pendingFollowUp: [],
      optimisticPendingUserText: null,
      agentTurnBootstrapping: false,
    })

    saveLiveSessionTimeline({
      sessionId: 'session-1',
      sessionFile,
      timelineItems: [
        { id: 'new-u', type: 'user-message', text: 'new q', sessionEntryId: 'new-u', timestamp: 5 },
        { id: 'new-a', type: 'assistant-message', text: 'new answer', sessionEntryId: 'new-a', timestamp: 6 },
      ],
      streamingAssistantId: null,
      runState: { status: 'idle', toolCount: 0, errorCount: 0 },
      pendingSteering: [],
      pendingFollowUp: [],
      optimisticPendingUserText: null,
      agentTurnBootstrapping: false,
    })

    expect(getLiveSessionTimeline(sessionFile)?.timelineItems.map((item) => item.id)).toEqual([
      'new-u',
      'new-a',
    ])
  })

  it('should_keep_new_turn_streaming_row_when_existing_cache_is_a_strict_prefix', () => {
    const sessionFile = '/tmp/new-turn-stream-row.jsonl'
    saveLiveSessionTimeline({
      sessionId: 'session-1',
      sessionFile,
      timelineItems: [
        { id: 'old-u1', type: 'user-message', text: 'q1', sessionEntryId: 'u1', timestamp: 1 },
        {
          id: 'old-a1',
          type: 'assistant-message',
          text: 'completed first answer with a much longer body',
          sessionEntryId: 'a1-entry',
          timestamp: 2,
        },
      ],
      streamingAssistantId: null,
      runState: { status: 'running', toolCount: 0, errorCount: 0 },
      pendingSteering: [],
      pendingFollowUp: [],
      optimisticPendingUserText: null,
      agentTurnBootstrapping: false,
    })

    saveLiveSessionTimeline({
      sessionId: 'session-1',
      sessionFile,
      timelineItems: [
        { id: 'new-u1', type: 'user-message', text: 'q1', sessionEntryId: 'u1', timestamp: 1 },
        {
          id: 'new-a1',
          type: 'assistant-message',
          text: 'completed first answer',
          sessionEntryId: 'a1-entry',
          timestamp: 2,
        },
        { id: 'new-u2', type: 'user-message', text: 'q2', sessionEntryId: 'u2', timestamp: 3 },
        { id: 'stream-a2', type: 'assistant-message', text: 'new', timestamp: 4 },
      ],
      streamingAssistantId: 'stream-a2',
      runState: { status: 'running', toolCount: 0, errorCount: 0 },
      pendingSteering: [],
      pendingFollowUp: [],
      optimisticPendingUserText: null,
      agentTurnBootstrapping: false,
    })

    let snapshot = getLiveSessionTimeline(sessionFile)
    expect(snapshot?.timelineItems.at(-1)).toMatchObject({
      id: 'stream-a2',
      text: 'new',
    })
    expect(snapshot?.timelineItems.at(-1)?.sessionEntryId).toBeUndefined()
    expect(snapshot?.streamingAssistantId).toBe('stream-a2')

    applyBackgroundAppEventToLiveTimeline(sessionFile, {
      type: 'message',
      role: 'assistant',
      phase: 'delta',
      contentKind: 'text',
      text: ' answer',
      seq: 1,
      workspaceId: '/workspace',
      sessionFile,
      timestamp: 5,
    })

    snapshot = getLiveSessionTimeline(sessionFile)
    expect(snapshot?.timelineItems.at(-1)).toMatchObject({
      id: 'stream-a2',
      text: 'new answer',
    })
    expect(snapshot?.timelineItems.at(-1)?.sessionEntryId).toBeUndefined()
    expect(snapshot?.streamingAssistantId).toBe('stream-a2')
    expect(snapshot?.timelineItems.find((item) => item.id === snapshot.streamingAssistantId)?.type).toBe(
      'assistant-message',
    )
  })

  it('should_remap_shorter_active_capture_pointer_and_append_later_delta', () => {
    const sessionFile = '/tmp/ordinary-shorter-capture.jsonl'
    saveLiveSessionTimeline({
      sessionId: 'session-1',
      sessionFile,
      timelineItems: [
        { id: 'u1', type: 'user-message', text: 'q', turnId: 'turn-1', timestamp: 1 },
        {
          id: 'a1',
          type: 'assistant-message',
          text: 'complete streamed answer',
          runId: 'run-1',
          turnId: 'turn-1',
          timestamp: 2,
        },
      ],
      streamingAssistantId: 'a1',
      runState: { status: 'running', toolCount: 0, errorCount: 0 },
      pendingSteering: [],
      pendingFollowUp: [],
      optimisticPendingUserText: null,
      agentTurnBootstrapping: false,
    })

    saveLiveSessionTimeline({
      sessionId: 'session-1',
      sessionFile,
      timelineItems: [
        {
          id: 'a-short',
          type: 'assistant-message',
          text: 'answer',
          runId: 'run-1',
          turnId: 'turn-1',
          timestamp: 2,
        },
      ],
      streamingAssistantId: 'a-short',
      runState: { status: 'running', toolCount: 0, errorCount: 0 },
      pendingSteering: [],
      pendingFollowUp: [],
      optimisticPendingUserText: null,
      agentTurnBootstrapping: false,
    })

    let snapshot = getLiveSessionTimeline(sessionFile)
    expect(snapshot?.timelineItems.map((item) => item.id)).toEqual(['u1', 'a1'])
    expect(snapshot?.streamingAssistantId).toBe('a1')
    const streamingAssistantId = snapshot?.streamingAssistantId
    expect(
      snapshot?.timelineItems.find((item) => item.id === streamingAssistantId),
    ).toMatchObject({
      type: 'assistant-message',
      runId: 'run-1',
    })

    applyBackgroundAppEventToLiveTimeline(sessionFile, {
      type: 'message',
      role: 'assistant',
      phase: 'delta',
      contentKind: 'text',
      text: ' plus',
      runId: 'run-1',
      turnId: 'turn-1',
      seq: 2,
      workspaceId: '/workspace',
      sessionFile,
      timestamp: 3,
    })

    snapshot = getLiveSessionTimeline(sessionFile)
    expect(snapshot?.timelineItems.find((item) => item.id === 'a1')?.text).toBe(
      'complete streamed answer plus',
    )
  })

  it('should_not_overwrite_new_turn_from_stale_idle_assistant_only_cache', () => {
    const sessionFile = '/tmp/stale-idle-assistant-only.jsonl'
    saveLiveSessionTimeline({
      sessionId: 'session-1',
      sessionFile,
      timelineItems: [
        {
          id: 'stale-a1',
          type: 'assistant-message',
          text: 'stale first answer with a much longer body',
          runId: 'run-1',
          timestamp: 1,
        },
      ],
      streamingAssistantId: null,
      runState: { status: 'idle', toolCount: 0, errorCount: 0 },
      pendingSteering: [],
      pendingFollowUp: [],
      optimisticPendingUserText: null,
      agentTurnBootstrapping: false,
    })

    saveLiveSessionTimeline({
      sessionId: 'session-1',
      sessionFile,
      timelineItems: [
        { id: 'u1', type: 'user-message', text: 'q1', sessionEntryId: 'u1', timestamp: 1 },
        { id: 'a1', type: 'assistant-message', text: 'first answer', runId: 'run-1', timestamp: 2 },
        { id: 'u2', type: 'user-message', text: 'q2', sessionEntryId: 'u2', timestamp: 3 },
        { id: 'a2', type: 'assistant-message', text: 'new turn partial', runId: 'run-2', timestamp: 4 },
      ],
      streamingAssistantId: 'a2',
      runState: { status: 'running', toolCount: 0, errorCount: 0 },
      pendingSteering: [],
      pendingFollowUp: [],
      optimisticPendingUserText: null,
      agentTurnBootstrapping: false,
    })

    const snapshot = getLiveSessionTimeline(sessionFile)
    expect(snapshot?.timelineItems.at(-1)).toMatchObject({
      id: 'a2',
      text: 'new turn partial',
      runId: 'run-2',
    })
    expect(snapshot?.streamingAssistantId).toBe('a2')
    const streamingAssistantId = snapshot?.streamingAssistantId
    expect(snapshot?.timelineItems.find((item) => item.id === streamingAssistantId)?.type).toBe(
      'assistant-message',
    )
  })

  it('should_enrich_matching_active_assistant_only_tail_and_keep_pointer_valid', () => {
    const sessionFile = '/tmp/active-assistant-only-tail.jsonl'
    saveLiveSessionTimeline({
      sessionId: 'session-1',
      sessionFile,
      timelineItems: [
        { id: 'u1', type: 'user-message', text: 'q', turnId: 'turn-1', timestamp: 1 },
        {
          id: 'a1',
          type: 'assistant-message',
          text: 'partial',
          runId: 'run-1',
          turnId: 'turn-1',
          timestamp: 2,
        },
      ],
      streamingAssistantId: 'a1',
      runState: { status: 'running', toolCount: 0, errorCount: 0 },
      pendingSteering: [],
      pendingFollowUp: [],
      optimisticPendingUserText: null,
      agentTurnBootstrapping: false,
    })

    saveLiveSessionTimeline({
      sessionId: 'session-1',
      sessionFile,
      timelineItems: [
        {
          id: 'tail-a1',
          type: 'assistant-message',
          text: 'partial and still streaming',
          runId: 'run-1',
          turnId: 'turn-1',
          timestamp: 3,
        },
      ],
      streamingAssistantId: 'tail-a1',
      runState: { status: 'running', toolCount: 0, errorCount: 0 },
      pendingSteering: [],
      pendingFollowUp: [],
      optimisticPendingUserText: null,
      agentTurnBootstrapping: false,
    })

    const snapshot = getLiveSessionTimeline(sessionFile)
    expect(snapshot?.timelineItems.at(-1)).toMatchObject({
      id: 'a1',
      text: 'partial and still streaming',
      runId: 'run-1',
    })
    expect(snapshot?.streamingAssistantId).toBe('a1')
    expect(snapshot?.timelineItems.find((item) => item.id === snapshot.streamingAssistantId)?.type).toBe(
      'assistant-message',
    )
  })

  it('should_bind_turn_id_to_background_optimistic_message_and_tool_rows', () => {
    const sessionFile = '/tmp/background-turn-id.jsonl'
    saveLiveSessionTimeline({
      sessionId: 'session-1',
      sessionFile,
      timelineItems: [
        { id: 'opt-user-turn', type: 'user-message', text: 'question', timestamp: 1 },
        {
          id: 'opt-asst-turn',
          type: 'assistant-message',
          text: '',
          thinkingText: '',
          timestamp: 2,
        },
      ],
      streamingAssistantId: 'opt-asst-turn',
      runState: { status: 'running', toolCount: 0, errorCount: 0 },
      pendingSteering: [],
      pendingFollowUp: [],
      optimisticPendingUserText: 'question',
      agentTurnBootstrapping: true,
    })

    applyBackgroundAppEventToLiveTimeline(sessionFile, {
      type: 'message',
      role: 'user',
      phase: 'start',
      text: 'question',
      turnId: 'turn-1',
      runId: 'run-1',
      seq: 1,
      workspaceId: '/workspace',
      sessionFile,
      timestamp: 3,
    })
    applyBackgroundAppEventToLiveTimeline(sessionFile, {
      type: 'message',
      role: 'user',
      phase: 'end',
      sessionEntryId: 'user-entry-turn',
      turnId: 'turn-1',
      runId: 'run-1',
      seq: 2,
      workspaceId: '/workspace',
      sessionFile,
      timestamp: 4,
    })
    applyBackgroundAppEventToLiveTimeline(sessionFile, {
      type: 'message',
      role: 'assistant',
      phase: 'start',
      turnId: 'turn-1',
      runId: 'run-1',
      seq: 3,
      workspaceId: '/workspace',
      sessionFile,
      timestamp: 5,
    })
    applyBackgroundAppEventToLiveTimeline(sessionFile, {
      type: 'message',
      role: 'assistant',
      phase: 'end',
      text: 'answer',
      sessionEntryId: 'assistant-entry-turn',
      turnId: 'turn-1',
      runId: 'run-1',
      seq: 4,
      workspaceId: '/workspace',
      sessionFile,
      timestamp: 6,
    })
    applyBackgroundAppEventToLiveTimeline(sessionFile, {
      type: 'tool',
      phase: 'start',
      toolCallId: 'tool-turn',
      toolName: 'read',
      input: {},
      turnId: 'turn-1',
      runId: 'run-1',
      seq: 5,
      workspaceId: '/workspace',
      sessionFile,
      timestamp: 7,
    })
    applyBackgroundAppEventToLiveTimeline(sessionFile, {
      type: 'tool',
      phase: 'end',
      toolCallId: 'tool-turn',
      toolName: 'read',
      output: 'ok',
      turnId: 'turn-1',
      runId: 'run-1',
      seq: 6,
      workspaceId: '/workspace',
      sessionFile,
      timestamp: 8,
    })

    const rows = getLiveSessionTimeline(sessionFile)?.timelineItems ?? []
    expect(rows.find((item) => item.id === 'opt-user-turn')).toMatchObject({
      turnId: 'turn-1',
      sessionEntryId: 'user-entry-turn',
    })
    expect(rows.find((item) => item.id === 'opt-asst-turn')).toMatchObject({
      turnId: 'turn-1',
      sessionEntryId: 'assistant-entry-turn',
    })
    expect(rows.find((item) => item.toolCallId === 'tool-turn')).toMatchObject({
      turnId: 'turn-1',
      toolPhase: 'end',
    })
  })

  it('should_clear_items_overlap_and_pending_deltas_for_rewind_boundary', () => {
    const sessionFile = '/tmp/clear-live-overlap.jsonl'
    saveLiveSessionTimeline({
      sessionId: 'session-1',
      sessionFile,
      timelineItems: [
        { id: 'assistant', type: 'assistant-message', text: '', timestamp: 1 },
      ],
      persistedEntryOverlap: ['parent-entry'],
      streamingAssistantId: 'assistant',
      runState: { status: 'running', toolCount: 0, errorCount: 0 },
      pendingSteering: [],
      pendingFollowUp: [],
      optimisticPendingUserText: null,
      agentTurnBootstrapping: false,
    })
    applyBackgroundAppEventToLiveTimeline(sessionFile, {
      type: 'message',
      role: 'assistant',
      phase: 'delta',
      contentKind: 'text',
      text: 'pending',
      seq: 1,
      workspaceId: '/workspace',
      sessionFile,
      timestamp: 2,
    })

    clearLiveSessionTimeline(sessionFile)

    expect(getLiveSessionTimeline(sessionFile)).toBeNull()
  })
})
