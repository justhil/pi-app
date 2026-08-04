import { describe, expect, it, vi } from 'vitest'
import type { ToolEvent } from '@shared/app-events'
import {
  collectActiveSubagentSessionChildren,
  reduceSubagentSessionGroupToolEvent,
} from './subagent-session-activity'

vi.mock('@renderer/features/timeline/tool-card-registry', () => ({
  resolveToolCardTemplate: (toolName: string | undefined) => toolName === 'subagent' ? 'tree' : undefined,
}))

describe('subagent sidebar activity lifecycle', () => {
  it('should_collect_only_pending_or_running_children_from_live_tree_tools', () => {
    const liveItems = [
      {
        id: 'tool-1',
        type: 'tool-call' as const,
        toolCallId: 'call-1',
        toolName: 'subagent',
        toolPhase: 'update',
        toolDetails: {
          results: [
            { agent: 'scout', progress: { status: 'running' } },
            { agent: 'reviewer', progress: { status: 'completed' } },
          ],
        },
        timestamp: 1,
      },
      {
        id: 'tool-2',
        type: 'tool-call' as const,
        toolCallId: 'call-2',
        toolName: 'subagent',
        toolPhase: 'end',
        toolDetails: {
          results: [{ agent: 'finished', exitCode: 0 }],
        },
        timestamp: 2,
      },
    ]

    expect(collectActiveSubagentSessionChildren(liveItems)).toEqual([
      expect.objectContaining({
        key: 'call-1:0',
        agent: 'scout',
        state: 'running',
      }),
    ])
  })

  it('should_reclaim_finished_children_without_unlocking_the_open_preview', () => {
    const group = {
      workspacePath: '/workspace',
      parentSessionId: 'parent-session',
      parentSessionFile: '/sessions/parent.jsonl',
      previewSessionFile: '/sessions/child.jsonl',
      children: [
        {
          key: 'call-1:0',
          agent: 'scout',
          state: 'running' as const,
          sessionFile: '/sessions/child.jsonl',
        },
      ],
    }
    const event: ToolEvent = {
      type: 'tool',
      seq: 2,
      workspaceId: '/workspace',
      sessionId: 'parent-session',
      sessionFile: '/sessions/parent.jsonl',
      toolCallId: 'call-1',
      toolName: 'subagent',
      phase: 'end',
      details: {
        results: [
          {
            agent: 'scout',
            exitCode: 0,
            sessionFile: '/sessions/child.jsonl',
          },
        ],
      },
      timestamp: 2,
    }

    expect(reduceSubagentSessionGroupToolEvent(group, event)).toEqual({
      ...group,
      children: [],
    })
  })

  it('should_keep_the_last_active_snapshot_when_an_update_has_no_details', () => {
    const group = {
      workspacePath: '/workspace',
      parentSessionId: 'parent-session',
      parentSessionFile: '/sessions/parent.jsonl',
      previewSessionFile: '/sessions/child.jsonl',
      children: [
        {
          key: 'call-1:0',
          agent: 'scout',
          state: 'running' as const,
          sessionFile: '/sessions/child.jsonl',
        },
      ],
    }
    const event: ToolEvent = {
      type: 'tool',
      seq: 2,
      workspaceId: '/workspace',
      sessionId: 'parent-session',
      sessionFile: '/sessions/parent.jsonl',
      toolCallId: 'call-1',
      toolName: 'subagent',
      phase: 'update',
      input: {
        agent: 'scout',
        task: 'Inspect the project',
      },
      output: 'Still working',
      timestamp: 2,
    }

    expect(reduceSubagentSessionGroupToolEvent(group, event)).toBe(group)
  })

  it('should_reclaim_only_the_finished_tool_call_when_other_children_are_running', () => {
    const group = {
      workspacePath: '/workspace',
      parentSessionId: 'parent-session',
      parentSessionFile: '/sessions/parent.jsonl',
      previewSessionFile: '/sessions/child-1.jsonl',
      children: [
        {
          key: 'call-1:0',
          agent: 'scout',
          state: 'running' as const,
          sessionFile: '/sessions/child-1.jsonl',
        },
        {
          key: 'call-2:0',
          agent: 'reviewer',
          state: 'running' as const,
          sessionFile: '/sessions/child-2.jsonl',
        },
      ],
    }
    const event: ToolEvent = {
      type: 'tool',
      seq: 3,
      workspaceId: '/workspace',
      sessionId: 'parent-session',
      sessionFile: '/sessions/parent.jsonl',
      toolCallId: 'call-1',
      toolName: 'subagent',
      phase: 'end',
      timestamp: 3,
    }

    expect(reduceSubagentSessionGroupToolEvent(group, event)).toEqual({
      ...group,
      children: [group.children[1]],
    })
  })
})
