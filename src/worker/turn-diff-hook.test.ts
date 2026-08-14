import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AgentSessionEvent } from '@earendil-works/pi-coding-agent'
import type { AppEvent, TurnDiffEvent } from '@shared/app-events'
import { handleSessionEvent, resetSessionEventTracking } from './worker-session-events'
import { resetTurnDiffState } from './turn-file-diff'
import type { SessionEventDeps } from './worker-session-events'

let dir = ''
let workspace = ''
const emittedEvents: AppEvent[] = []

function harness(): SessionEventDeps {
  let seq = 0
  let runId = 'run-1'
  let turnId = 'turn-1'
  return {
    baseEvent: () => ({
      seq: ++seq,
      workspaceId: workspace,
      sessionId: 'session-1',
      sessionFile: join(workspace, 'session.jsonl'),
      runId,
      turnId,
      timestamp: seq,
    }),
    emit: (e) => emittedEvents.push(e),
    getSession: () => null,
    getCwd: () => workspace,
    getSessionModelKey: () => 'provider/model',
    getUiBridge: () => null,
    isAgentTurnActive: () => false,
    setAgentTurnActive: () => {},
    setPromptPreflightActive: () => {},
    setCurrentRunId: (r) => {
      runId = r
    },
    setCurrentTurnId: (t) => {
      turnId = t
    },
    nextSeq: () => ++seq,
  }
}

function filePath(name: string): string {
  return join(workspace, name)
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'pi-turn-hook-'))
  workspace = join(dir, 'ws')
  mkdirSync(workspace, { recursive: true })
  emittedEvents.length = 0
  resetSessionEventTracking()
  resetTurnDiffState()
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('worker turn_diff emission through session events', () => {
  it('captures a baseline on tool start and emits the net diff on turn_end', async () => {
    const deps = harness()
    writeFileSync(filePath('note.md'), 'before\n')

    handleSessionEvent(
      {
        type: 'agent_start',
      } as AgentSessionEvent,
      deps,
    )
    handleSessionEvent(
      {
        type: 'tool_execution_start',
        toolCallId: 'call-1',
        toolName: 'edit',
        args: { path: filePath('note.md'), old_string: 'before', new_string: 'after' },
      } as AgentSessionEvent,
      deps,
    )
    // 等基线读取完成（真实流程中工具执行在基线之后，这里用 tick 模拟）
    await new Promise((r) => setTimeout(r, 20))
    // 模拟工具实际改盘
    writeFileSync(filePath('note.md'), 'after\n')

    handleSessionEvent(
      {
        type: 'turn_end',
        message: {},
      } as AgentSessionEvent,
      deps,
    )
    // finalize 是异步结算：等微任务与文件读取完成
    await new Promise((r) => setTimeout(r, 50))

    const diffEvents = emittedEvents.filter((e) => e.type === 'turn_diff') as TurnDiffEvent[]
    expect(diffEvents).toHaveLength(1)
    expect(diffEvents[0].files).toHaveLength(1)
    expect(diffEvents[0].files[0].path).toBe(filePath('note.md'))
    expect(diffEvents[0].files[0].status).toBe('modified')
    expect(diffEvents[0].files[0].diffText).toContain('-before')
    expect(diffEvents[0].files[0].diffText).toContain('+after')
    expect(diffEvents[0].turnId).toBe(deps.baseEvent().turnId)
  })

  it('emits on agent_settled when turn_end never fired (aborted path)', async () => {
    const deps = harness()
    handleSessionEvent({ type: 'agent_start' } as AgentSessionEvent, deps)
    handleSessionEvent(
      {
        type: 'tool_execution_start',
        toolCallId: 'call-2',
        toolName: 'write',
        args: { path: filePath('new.txt'), content: 'x' },
      } as AgentSessionEvent,
      deps,
    )
    await new Promise((r) => setTimeout(r, 20))
    writeFileSync(filePath('new.txt'), 'x\n')
    handleSessionEvent({ type: 'agent_settled' } as AgentSessionEvent, deps)
    await new Promise((r) => setTimeout(r, 50))

    const diffEvents = emittedEvents.filter((e) => e.type === 'turn_diff') as TurnDiffEvent[]
    expect(diffEvents.length).toBeGreaterThanOrEqual(1)
    expect(diffEvents[0].files[0].status).toBe('added')
  })
})
