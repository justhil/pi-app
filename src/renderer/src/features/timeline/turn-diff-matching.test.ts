import { beforeEach, describe, expect, it } from 'vitest'
import { buildTimelineDisplayItems, type TimelineRawItem } from './timeline-display-items'
import { groupDisplayBlocksByTurn } from './timeline-turn-groups'
import {
  applyTurnDiffToSummary,
  buildTurnActivitySummary,
  collectRunIdsFromBlocks,
  collectTurnIdsFromBlocks,
} from './timeline-turn-activity'
import { useTurnDiffStore, findTurnDiffRecord } from '@renderer/stores/turn-diff-store'
import type { TurnDiffFile } from '@shared/app-events'

function liveTurnItems(): TimelineRawItem[] {
  return [
    {
      id: 'u1',
      type: 'user-message',
      text: 'fix it',
      runId: 'run-1',
      turnId: 'turn-2',
      timestamp: 1,
    },
    {
      id: 't1',
      type: 'tool-call',
      toolCallId: 'call-1',
      toolName: 'edit',
      toolPhase: 'end',
      toolArgs: { path: 'D:/proj/src/main.cpp', old_string: 'a', new_string: 'b' },
      runId: 'run-1',
      turnId: 'turn-2',
      timestamp: 2,
    },
    {
      id: 'a1',
      type: 'assistant-message',
      text: 'done',
      runId: 'run-1',
      turnId: 'turn-2',
      timestamp: 3,
    },
  ]
}

describe('turn diff matching pipeline (live items)', () => {
  beforeEach(() => {
    useTurnDiffStore.setState({ records: [] })
  })

  it('matches a turn_diff record by turnId and attaches the net diff to the summary', () => {
    const items = liveTurnItems()
    const blocks = buildTimelineDisplayItems(items)
    const { turns } = groupDisplayBlocksByTurn(blocks)
    expect(turns).toHaveLength(1)

    const diffFile: TurnDiffFile = {
      path: 'D:/proj/src/main.cpp',
      status: 'modified',
      additions: 1,
      deletions: 1,
      diffText: '--- a/src/main.cpp\n+++ b/src/main.cpp\n@@ -1 +1 @@\n-a\n+b\n',
    }
    useTurnDiffStore.getState().addRecord({
      sessionFile: 'D:/proj/sessions/s1.jsonl',
      turnId: 'turn-2',
      runId: 'run-1',
      files: [diffFile],
      updatedAt: 4,
    })

    const turnBlocks = turns[0].blocks
    const record = findTurnDiffRecord(
      'D:/proj/sessions/s1.jsonl',
      collectTurnIdsFromBlocks(turnBlocks),
      [...collectRunIdsFromBlocks(turnBlocks)],
    )
    expect(record).not.toBeNull()

    const summary = buildTurnActivitySummary(turnBlocks, [], {
      runIds: collectRunIdsFromBlocks(turnBlocks),
      workspaceRoot: 'D:/proj',
    })
    const merged = applyTurnDiffToSummary(summary, record!.files, 'D:/proj')
    expect(merged.files).toHaveLength(1)
    expect(merged.files[0].diffText).toContain('-a')
    expect(merged.files[0].diffStatus).toBe('modified')
  })

  it('falls back to turn ordinal when blocks lost their turnId/runId (disk-projected view)', () => {
    const items = [
      { id: 'u1', type: 'user-message', text: 'x', timestamp: 1 },
      {
        id: 't1',
        type: 'tool-call',
        toolCallId: 'call-1',
        toolName: 'edit',
        toolPhase: 'end',
        toolArgs: { path: 'D:/proj/src/a.cpp', old_string: 'a', new_string: 'b' },
        timestamp: 2,
      },
      { id: 'a1', type: 'assistant-message', text: 'ok', timestamp: 3 },
    ]
    useTurnDiffStore.getState().addRecord({
      sessionFile: 'D:/proj/sessions/s1.jsonl',
      turnOrdinal: 1,
      files: [
        {
          path: 'D:/proj/src/a.cpp',
          status: 'modified',
          additions: 1,
          deletions: 1,
          diffText: '--- a/a.cpp\n+++ b/a.cpp\n@@ -1 +1 @@\n-a\n+b\n',
        },
      ],
      updatedAt: 4,
    })
    const blocks = buildTimelineDisplayItems(items)
    const { turns } = groupDisplayBlocksByTurn(blocks)
    const turnBlocks = turns[0].blocks
    const record = findTurnDiffRecord('D:/proj/sessions/s1.jsonl', [], [], {
      turnOrdinal: 1,
    })
    expect(record).not.toBeNull()
    const summary = buildTurnActivitySummary(turnBlocks, [], {
      runIds: new Set(),
      workspaceRoot: 'D:/proj',
    })
    const merged = applyTurnDiffToSummary(summary, record!.files, 'D:/proj')
    expect(merged.files[0].diffText).toContain('+b')
  })

  it('uses the newest record for the last completed turn as a final fallback', () => {
    useTurnDiffStore.getState().addRecord({
      sessionFile: 'D:/proj/sessions/s1.jsonl',
      turnOrdinal: 3,
      files: [
        {
          path: 'D:/proj/src/b.md',
          status: 'added',
          additions: 1,
          deletions: 0,
          diffText: '+new',
        },
      ],
      updatedAt: 9,
    })
    const record = findTurnDiffRecord('D:/proj/sessions/s1.jsonl', [], [], {
      turnOrdinal: 99, // 视图序号与 worker 序号不一致（部分加载）
      fallbackNewest: true,
    })
    expect(record).not.toBeNull()
    expect(record!.files[0].path).toContain('b.md')
  })

  it('does not use the newest-record fallback for non-last turns', () => {
    useTurnDiffStore.getState().addRecord({
      sessionFile: 'D:/proj/sessions/s1.jsonl',
      turnOrdinal: 1,
      files: [],
      updatedAt: 1,
    })
    const record = findTurnDiffRecord('D:/proj/sessions/s1.jsonl', [], [], {
      turnOrdinal: 2,
      fallbackNewest: false,
    })
    expect(record).toBeNull()
  })

  it('falls back to tool-derived rows without diff when no record matches (disk-loaded history)', () => {
    const items = [
      { id: 'u1', type: 'user-message', text: 'x', timestamp: 1 },
      {
        id: 't1',
        type: 'tool-call',
        toolCallId: 'call-1',
        toolName: 'edit',
        toolPhase: 'end',
        toolArgs: { path: 'D:/proj/src/a.md', old_string: 'a', new_string: 'b' },
        timestamp: 2,
      },
      { id: 'a1', type: 'assistant-message', text: 'ok', timestamp: 3 },
    ]
    const blocks = buildTimelineDisplayItems(items)
    const { turns } = groupDisplayBlocksByTurn(blocks)
    const turnBlocks = turns[0].blocks
    const record = findTurnDiffRecord(
      'D:/proj/sessions/s1.jsonl',
      collectTurnIdsFromBlocks(turnBlocks),
      [...collectRunIdsFromBlocks(turnBlocks)],
    )
    expect(record).toBeNull()

    const summary = buildTurnActivitySummary(turnBlocks, [], {
      runIds: collectRunIdsFromBlocks(turnBlocks),
      workspaceRoot: 'D:/proj',
    })
    const merged = applyTurnDiffToSummary(summary, null, 'D:/proj')
    expect(merged.files).toHaveLength(1)
    expect(merged.files[0].diffText).toBeUndefined()
    expect(merged.files[0].skipReason).toBeUndefined()
    // 历史回合（磁盘加载）：回退到工具记录里的逐操作 diff
    expect(merged.files[0].opDiffs).toHaveLength(1)
    expect(merged.files[0].opDiffs![0].rows.some((r) => r.kind === 'add')).toBe(true)
  })

  it('drops opDiffs when a net diff record matches the file', () => {
    const items = [
      { id: 'u1', type: 'user-message', text: 'x', timestamp: 1 },
      {
        id: 't1',
        type: 'tool-call',
        toolCallId: 'call-1',
        toolName: 'edit',
        toolPhase: 'end',
        toolArgs: { path: 'D:/proj/src/a.md', old_string: 'a', new_string: 'b' },
        timestamp: 2,
      },
      { id: 'a1', type: 'assistant-message', text: 'ok', timestamp: 3 },
    ]
    const blocks = buildTimelineDisplayItems(items)
    const { turns } = groupDisplayBlocksByTurn(blocks)
    const turnBlocks = turns[0].blocks
    const summary = buildTurnActivitySummary(turnBlocks, [], {
      runIds: new Set(),
      workspaceRoot: 'D:/proj',
    })
    expect(summary.files[0].opDiffs).toBeDefined()
    const merged = applyTurnDiffToSummary(
      summary,
      [
        {
          path: 'D:/proj/src/a.md',
          status: 'modified',
          additions: 1,
          deletions: 1,
          diffText: '--- a/a.md\n+++ b/a.md\n-a\n+b\n',
        },
      ],
      'D:/proj',
    )
    expect(merged.files[0].diffText).toContain('+b')
    expect(merged.files[0].opDiffs).toBeUndefined()
  })
})
