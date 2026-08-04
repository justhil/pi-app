import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useUIStore } from '@renderer/stores/ui-store'
import { beginSessionNavigation } from '@renderer/lib/session-navigation'
import {
  collectSubagentSessionChildren,
  openSubagentSessionPreview,
} from './subagent-session-navigation'

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  previewSessionInPlace: vi.fn(),
}))

vi.mock('@renderer/lib/ipc-client', () => ({
  ipcClient: { invoke: mocks.invoke },
}))

vi.mock('@renderer/lib/activate-workspace', () => ({
  previewSessionInPlace: mocks.previewSessionInPlace,
}))

vi.mock('@renderer/features/timeline/tool-card-registry', () => ({
  resolveToolCardTemplate: (toolName: string | undefined) => toolName === 'subagent' ? 'tree' : undefined,
}))

describe('subagent session navigation', () => {
  beforeEach(() => {
    mocks.invoke.mockReset()
    mocks.previewSessionInPlace.mockReset()
    mocks.previewSessionInPlace.mockResolvedValue(undefined)
    useUIStore.setState({
      currentWorkspace: '/workspace',
      currentSessionId: 'parent-session',
      historySessionFile: '/sessions/parent.jsonl',
      subagentSessionGroup: null,
      timelineItems: [
        {
          id: 'tool-1',
          type: 'tool-call',
          toolCallId: 'subagent-call-1',
          toolName: 'subagent',
          toolPhase: 'end',
          toolDetails: {
            mode: 'parallel',
            results: [
              {
                agent: 'scout',
                task: 'Inspect the project',
                exitCode: 0,
                sessionFile: '/sessions/parent/run-1/session.jsonl',
              },
              {
                agent: 'reviewer',
                task: 'Review the result',
                exitCode: 0,
                sessionFile: '/sessions/parent/run-2/session.jsonl',
              },
            ],
          },
          timestamp: 1,
        },
      ],
    })
  })

  it('should_collect_navigable_children_from_tree_tool_rows', () => {
    const children = collectSubagentSessionChildren(useUIStore.getState().timelineItems)

    expect(children).toEqual([
      expect.objectContaining({
        key: 'subagent-call-1:0',
        agent: 'scout',
        sessionFile: '/sessions/parent/run-1/session.jsonl',
      }),
      expect.objectContaining({
        key: 'subagent-call-1:1',
        agent: 'reviewer',
        sessionFile: '/sessions/parent/run-2/session.jsonl',
      }),
    ])
  })

  it('should_open_child_as_read_only_preview_and_remember_the_parent_tree', async () => {
    mocks.invoke.mockResolvedValue({ sessionId: 'child-session' })

    await openSubagentSessionPreview('/sessions/parent/run-1/session.jsonl')

    expect(mocks.invoke).toHaveBeenCalledWith('session.prepare', {
      sessionFile: '/sessions/parent/run-1/session.jsonl',
      bind: false,
    })
    expect(useUIStore.getState().subagentSessionGroup).toMatchObject({
      workspacePath: '/workspace',
      parentSessionId: 'parent-session',
      parentSessionFile: '/sessions/parent.jsonl',
      previewSessionFile: '/sessions/parent/run-1/session.jsonl',
      children: [],
    })
    expect(mocks.previewSessionInPlace).toHaveBeenCalledWith(
      'child-session',
      '/sessions/parent/run-1/session.jsonl',
      expect.any(Number),
    )
  })

  it('should_open_resolved_running_child_session_when_prepare_replaces_candidate_path', async () => {
    const candidateSessionFile = '/sessions/parent/run-live/run-0/session.jsonl'
    const resolvedSessionFile = '/sessions/forked-child.jsonl'
    useUIStore.setState({
      timelineItems: [
        {
          id: 'tool-live',
          type: 'tool-call',
          toolCallId: 'subagent-live',
          toolName: 'subagent',
          toolPhase: 'update',
          toolDetails: {
            mode: 'single',
            runId: 'run-live',
            results: [
              {
                agent: 'worker',
                sessionFile: candidateSessionFile,
                progress: { status: 'running' },
              },
            ],
          },
          timestamp: 1,
        },
      ],
    })
    mocks.invoke.mockResolvedValue({
      sessionId: 'forked-child-session',
      sessionFile: resolvedSessionFile,
    })

    await openSubagentSessionPreview(candidateSessionFile)

    expect(useUIStore.getState().subagentSessionGroup).toMatchObject({
      previewSessionFile: resolvedSessionFile,
      children: [
        expect.objectContaining({
          sessionFile: resolvedSessionFile,
        }),
      ],
    })
    expect(mocks.previewSessionInPlace).toHaveBeenCalledWith(
      'forked-child-session',
      resolvedSessionFile,
      expect.any(Number),
    )
  })

  it('should_not_override_a_newer_navigation_when_prepare_finishes_late', async () => {
    let resolvePrepare: ((value: { sessionId: string }) => void) | undefined
    mocks.invoke.mockReturnValue(new Promise((resolve) => {
      resolvePrepare = resolve
    }))

    const pendingPreview = openSubagentSessionPreview('/sessions/parent/run-1/session.jsonl')
    beginSessionNavigation()
    resolvePrepare?.({ sessionId: 'child-session' })
    await pendingPreview

    expect(mocks.previewSessionInPlace).not.toHaveBeenCalled()
    expect(useUIStore.getState().subagentSessionGroup).toBeNull()
  })

  it('should_keep_the_root_sidebar_group_when_opening_a_nested_child', async () => {
    useUIStore.setState({
      currentSessionId: 'child-session',
      historySessionFile: '/sessions/parent/run-1/session.jsonl',
      subagentSessionGroup: {
        workspacePath: '/workspace',
        parentSessionId: 'parent-session',
        parentSessionFile: '/sessions/parent.jsonl',
        previewSessionFile: '/sessions/parent/run-1/session.jsonl',
        children: [
          {
            key: 'subagent-call-1:0',
            agent: 'scout',
            state: 'running',
            sessionFile: '/sessions/parent/run-1/session.jsonl',
          },
        ],
      },
      timelineItems: [
        {
          id: 'nested-tool',
          type: 'tool-call',
          toolCallId: 'nested-call',
          toolName: 'subagent',
          toolPhase: 'end',
          toolDetails: {
            results: [
              {
                agent: 'nested-scout',
                exitCode: 0,
                sessionFile: '/sessions/parent/run-1/nested/session.jsonl',
              },
            ],
          },
          timestamp: 2,
        },
      ],
    })
    mocks.invoke.mockResolvedValue({ sessionId: 'nested-child-session' })

    await openSubagentSessionPreview('/sessions/parent/run-1/nested/session.jsonl')

    expect(useUIStore.getState().subagentSessionGroup).toMatchObject({
      parentSessionId: 'parent-session',
      parentSessionFile: '/sessions/parent.jsonl',
      previewSessionFile: '/sessions/parent/run-1/nested/session.jsonl',
      children: [
        { agent: 'scout' },
      ],
    })
  })
})
