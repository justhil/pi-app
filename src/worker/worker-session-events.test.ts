import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentSessionEvent } from '@earendil-works/pi-coding-agent'
import type { AppEvent } from '@shared/app-events'
import { handleSessionEvent, resetSessionEventTracking } from './worker-session-events'
import type { SessionEventDeps } from './worker-session-events'
import { handlePrompt } from './handlers/worker-handlers-turn'
import { st } from './worker-runtime'

type SessionEventHarness = {
  dependencies: SessionEventDeps
  emittedEvents: AppEvent[]
  getAgentTurnActive: () => boolean
  getCurrentRunId: () => string
  getCurrentTurnId: () => string
  setLeafId: (leafId: string | null) => void
}

function createSessionEventHarness(): SessionEventHarness {
  const emittedEvents: AppEvent[] = []
  let sequence = 0
  let agentTurnActive = false
  let currentRunId = 'run-old'
  let currentTurnId = 'turn-old'
  let leafId: string | null = 'entry-before-message'

  const dependencies: SessionEventDeps = {
    baseEvent: () => ({
      seq: ++sequence,
      workspaceId: '/workspace',
      sessionId: 'session-1',
      sessionFile: '/workspace/session.jsonl',
      runId: currentRunId,
      turnId: currentTurnId,
      timestamp: sequence,
    }),
    emit: (event) => emittedEvents.push(event),
    getSession: () =>
      ({
        sessionManager: {
          getLeafId: () => leafId,
        },
      }) as never,
    getSessionModelKey: () => 'provider/model',
    getUiBridge: () => null,
    isAgentTurnActive: () => agentTurnActive,
    setAgentTurnActive: (value) => {
      agentTurnActive = value
    },
    setPromptPreflightActive: () => {},
    setCurrentRunId: (runId) => {
      currentRunId = runId
    },
    setCurrentTurnId: (turnId) => {
      currentTurnId = turnId
    },
    nextSeq: () => ++sequence,
  }

  return {
    dependencies,
    emittedEvents,
    getAgentTurnActive: () => agentTurnActive,
    getCurrentRunId: () => currentRunId,
    getCurrentTurnId: () => currentTurnId,
    setLeafId: (nextLeafId) => {
      leafId = nextLeafId
    },
  }
}

describe('worker session event lifecycle', () => {
  beforeEach(() => {
    delete process.env.PI_AUDIO_TRACE
    resetSessionEventTracking()
  })

  it('should_publish_fresh_run_identity_when_agent_starts', () => {
    const harness = createSessionEventHarness()

    handleSessionEvent({ type: 'agent_start' } as AgentSessionEvent, harness.dependencies)

    const runningEvent = harness.emittedEvents.find(
      (event) => event.type === 'run' && event.phase === 'running',
    )
    expect(runningEvent).toMatchObject({
      runId: harness.getCurrentRunId(),
      turnId: harness.getCurrentTurnId(),
    })
    expect(runningEvent).not.toMatchObject({ runId: 'run-old' })
    expect(runningEvent).not.toMatchObject({ turnId: 'turn-old' })
  })

  it('should_preserve_provisional_run_identity_when_agent_starts', () => {
    const harness = createSessionEventHarness()
    harness.dependencies.setCurrentRunId('run-provisional')
    harness.dependencies.setCurrentTurnId('turn-provisional')
    harness.dependencies.setAgentTurnActive(true)

    handleSessionEvent({ type: 'agent_start' } as AgentSessionEvent, harness.dependencies)

    expect(harness.getCurrentRunId()).toBe('run-provisional')
    expect(harness.getCurrentTurnId()).toBe('turn-provisional')
    expect(harness.emittedEvents).toContainEqual(
      expect.objectContaining({
        type: 'run',
        phase: 'running',
        runId: 'run-provisional',
        turnId: 'turn-provisional',
      }),
    )
  })

  it('should_wait_for_agent_settled_before_emitting_terminal_run_event', async () => {
    const harness = createSessionEventHarness()
    harness.dependencies.setAgentTurnActive(true)

    handleSessionEvent(
      { type: 'agent_end', messages: [], willRetry: false } as AgentSessionEvent,
      harness.dependencies,
    )

    expect(
      harness.emittedEvents.filter(
        (event) =>
          event.type === 'run' &&
          (event.phase === 'idle' || event.phase === 'failed' || event.phase === 'cancelled'),
      ),
    ).toEqual([])
    expect(harness.getAgentTurnActive()).toBe(true)

    handleSessionEvent({ type: 'agent_settled' } as AgentSessionEvent, harness.dependencies)
    await Promise.resolve()

    expect(
      harness.emittedEvents.filter(
        (event) =>
          event.type === 'run' &&
          (event.phase === 'idle' || event.phase === 'failed' || event.phase === 'cancelled'),
      ),
    ).toEqual([expect.objectContaining({ type: 'run', phase: 'idle' })])
    expect(harness.getAgentTurnActive()).toBe(false)
  })

  it('should_forward_delivered_queued_user_message_start_with_text', () => {
    const harness = createSessionEventHarness()

    handleSessionEvent(
      {
        type: 'message_start',
        message: {
          role: 'user',
          content: [{ type: 'text', text: 'queued follow-up' }],
        },
      } as AgentSessionEvent,
      harness.dependencies,
    )

    expect(harness.emittedEvents).toContainEqual(
      expect.objectContaining({
        type: 'message',
        role: 'user',
        phase: 'start',
        text: 'queued follow-up',
      }),
    )
  })

  it('preserves structured details from tool progress updates', () => {
    const harness = createSessionEventHarness()
    const details = {
      mode: 'parallel',
      progress: [{ agent: 'scout', status: 'running', toolCount: 3 }],
    }

    handleSessionEvent(
      {
        type: 'tool_execution_update',
        toolCallId: 'subagent-call-1',
        toolName: 'subagent',
        partialResult: {
          content: [{ type: 'text', text: '1 agent running' }],
          details,
        },
      } as unknown as AgentSessionEvent,
      harness.dependencies,
    )

    expect(harness.emittedEvents).toContainEqual(
      expect.objectContaining({
        type: 'tool',
        phase: 'update',
        toolCallId: 'subagent-call-1',
        details,
      }),
    )
  })

  it('should_expose_running_child_session_file_when_subagent_progress_updates', () => {
    const harness = createSessionEventHarness()

    handleSessionEvent(
      {
        type: 'tool_execution_update',
        toolCallId: 'subagent-call-1',
        toolName: 'subagent',
        partialResult: {
          content: [{ type: 'text', text: '1 agent running' }],
          details: {
            mode: 'single',
            runId: 'a87a8307',
            results: [
              {
                agent: 'scout',
                progress: {
                  index: 0,
                  status: 'running',
                },
              },
            ],
          },
        },
      } as unknown as AgentSessionEvent,
      harness.dependencies,
    )

    expect(harness.emittedEvents).toContainEqual(
      expect.objectContaining({
        type: 'tool',
        phase: 'update',
        details: expect.objectContaining({
          results: [
            expect.objectContaining({
              sessionFile: expect.stringMatching(
                /session[\\/]a87a8307[\\/]run-0[\\/]session\.jsonl$/,
              ),
            }),
          ],
        }),
      }),
    )
  })

  it('should_keep_repeated_deltas_in_cumulative_state_before_snapshot', () => {
    const harness = createSessionEventHarness()
    handleSessionEvent(
      {
        type: 'message_start',
        message: { role: 'assistant', content: [] },
      } as unknown as AgentSessionEvent,
      harness.dependencies,
    )

    for (const delta of ['ha', 'ha']) {
      handleSessionEvent(
        {
          type: 'message_update',
          message: { role: 'assistant', content: [] },
          assistantMessageEvent: { type: 'text_delta', delta },
        } as unknown as AgentSessionEvent,
        harness.dependencies,
      )
    }
    handleSessionEvent(
      {
        type: 'message_update',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'haha' }],
        },
        assistantMessageEvent: { type: 'text_end', content: 'haha' },
      } as AgentSessionEvent,
      harness.dependencies,
    )

    const textChunks = harness.emittedEvents
      .filter(
        (event) =>
          event.type === 'message' &&
          event.phase === 'delta' &&
          event.contentKind === 'text',
      )
      .map((event) => (event.type === 'message' ? event.text : undefined))

    expect(textChunks).toEqual(['ha', 'ha'])
  })

  it('should_emit_only_new_suffix_when_assistant_snapshot_grows', () => {
    const harness = createSessionEventHarness()
    handleSessionEvent(
      {
        type: 'message_start',
        message: { role: 'assistant', content: [] },
      } as unknown as AgentSessionEvent,
      harness.dependencies,
    )

    for (const text of ['Hel', 'Hello', 'Hello!']) {
      handleSessionEvent(
        {
          type: 'message_update',
          message: {
            role: 'assistant',
            content: [{ type: 'text', text }],
          },
          assistantMessageEvent: { type: 'text_delta', delta: text.slice(-1) },
        } as AgentSessionEvent,
        harness.dependencies,
      )
    }

    const textChunks = harness.emittedEvents
      .filter(
        (event) =>
          event.type === 'message' &&
          event.phase === 'delta' &&
          event.contentKind === 'text',
      )
      .map((event) => (event.type === 'message' ? event.text : undefined))

    expect(textChunks).toEqual(['Hel', 'lo', '!'])
  })

  it('should_use_post_persist_leaf_for_completed_message_identity', async () => {
    const harness = createSessionEventHarness()

    handleSessionEvent(
      {
        type: 'message_end',
        message: {
          role: 'user',
          content: [{ type: 'text', text: 'hello' }],
        },
      } as AgentSessionEvent,
      harness.dependencies,
    )
    harness.setLeafId('entry-for-user-message')
    await Promise.resolve()

    expect(harness.emittedEvents).toContainEqual(
      expect.objectContaining({
        type: 'message',
        role: 'user',
        phase: 'end',
        sessionEntryId: 'entry-for-user-message',
      }),
    )
  })

  it('should_release_provisional_busy_state_when_prompt_is_consumed_without_agent_start', async () => {
    const originalSession = st.session
    const originalAgentTurnActive = st.agentTurnActive
    const originalPromptPreflightActive = st.promptPreflightActive
    const originalRunId = st.currentRunId
    const originalTurnId = st.currentTurnId
    const replies: Record<string, unknown>[] = []

    try {
      st.session = {
        isStreaming: false,
        sessionFile: '/workspace/session.jsonl',
        prompt: vi.fn().mockResolvedValue(undefined),
      } as never
      st.agentTurnActive = false
      st.promptPreflightActive = false
      st.currentRunId = ''
      st.currentTurnId = ''

      await handlePrompt(
        { type: 'prompt', text: '/extension-command' },
        (payload) => replies.push(payload),
      )

      expect(replies).toContainEqual({ type: 'prompt-done' })
      await vi.waitFor(() => {
        expect(st.agentTurnActive).toBe(false)
        expect(st.promptPreflightActive).toBe(false)
      })
      expect(st.currentRunId).toMatch(/^run-/)
      expect(st.currentTurnId).toMatch(/^turn-/)
    } finally {
      st.session = originalSession
      st.agentTurnActive = originalAgentTurnActive
      st.promptPreflightActive = originalPromptPreflightActive
      st.currentRunId = originalRunId
      st.currentTurnId = originalTurnId
    }
  })
})
