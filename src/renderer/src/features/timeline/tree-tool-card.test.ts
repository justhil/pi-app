import { describe, expect, it } from 'vitest'
import { normalizeTreeToolItem } from './tree-tool-model'

describe('normalizeTreeToolItem', () => {
  it('keeps duplicate agents distinct and projects live progress', () => {
    const view = normalizeTreeToolItem({
      id: 'row-1',
      toolCallId: 'call-1',
      toolName: 'subagent',
      toolPhase: 'update',
      toolDetails: {
        mode: 'parallel',
        runId: 'run-1',
        results: [
          { agent: 'scout', task: 'first', progress: { status: 'running', toolCount: 4 } },
          { agent: 'scout', task: 'second', progress: { status: 'completed', tokens: 1200 } },
        ],
      },
    })

    expect(view).toMatchObject({
      phase: 'running',
      runningCount: 1,
      completedCount: 1,
      hasReliableRunningCount: true,
    })
    expect(view.children.map((child) => [child.key, child.agent, child.state])).toEqual([
      ['call-1:0', 'scout', 'running'],
      ['call-1:1', 'scout', 'completed'],
    ])
  })

  it('derives final failures from real pi-subagents result fields', () => {
    const view = normalizeTreeToolItem({
      id: 'row-2',
      toolCallId: 'call-2',
      toolPhase: 'end',
      isError: false,
      toolDetails: {
        mode: 'parallel',
        results: [
          { agent: 'implement', exitCode: 0, progressSummary: { toolCount: 8 } },
          { agent: 'check', exitCode: 1, timedOut: true, error: 'deadline exceeded' },
        ],
      },
    })

    expect(view.phase).toBe('failed')
    expect(view.completedCount).toBe(1)
    expect(view.failedCount).toBe(1)
    expect(view.children[1]).toMatchObject({
      state: 'failed',
      failureKind: 'timedOut',
      error: 'deadline exceeded',
    })
  })

  it('should_preserve_child_session_file_when_result_can_be_opened', () => {
    const view = normalizeTreeToolItem({
      id: 'row-session',
      toolCallId: 'call-session',
      toolPhase: 'end',
      toolDetails: {
        mode: 'single',
        results: [
          {
            agent: 'scout',
            exitCode: 0,
            sessionFile: 'C:\\sessions\\child-session.jsonl',
          },
        ],
      },
    })

    expect(view.children[0].sessionFile).toBe('C:\\sessions\\child-session.jsonl')
  })

  it('marks an async launch receipt as detached instead of permanently running', () => {
    const view = normalizeTreeToolItem({
      id: 'row-3',
      toolPhase: 'end',
      toolOutput: 'The async run is detached and running in the background.',
      toolDetails: {
        mode: 'single',
        runId: 'async-1',
        asyncId: 'async-1',
        results: [],
      },
    })

    expect(view.phase).toBe('detached')
    expect(view.runningCount).toBe(0)
    expect(view.fallbackText).toContain('detached')
  })
})
