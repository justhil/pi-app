import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentSession } from '@earendil-works/pi-coding-agent'
import { st } from './worker-runtime'
import { handleAbort, handlePrompt } from './handlers/worker-handlers-turn'
import { handleNavigatetree } from './handlers/worker-handlers-session'

const originalState = { ...st }

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (err: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

beforeEach(() => {
  Object.assign(st, originalState)
  st.seq = 0
  st.turnSeq = 0
  st.abortedTurnSeq = 0
  st.abortingTurn = false
  st.activeTurnPromise = null
  st.promptTicket = 0
  st.cancelledPromptTicket = 0
  st.pendingFreshPrompts = 0
  st.agentTurnActive = false
  st.promptPreflightActive = false
  st.abortAfterPreflight = false
  st.promptSent = false
})

afterEach(() => {
  Object.assign(st, originalState)
})

describe('worker fast abort, fresh re-send queue, and busy rewind', () => {
  it('queues a fresh prompt during aborting settle window as a new turn instead of followUp', async () => {
    const firstTurn = deferred<void>()
    const secondTurn = deferred<void>()
    const promptCalls: Array<{ text: string; options: unknown }> = []
    const clearQueue = vi.fn()
    const abort = vi.fn().mockImplementation(async () => {
      st.agentTurnActive = false
      firstTurn.resolve()
    })

    st.session = {
      sessionId: 's1',
      sessionFile: '/sessions/s1.jsonl',
      isStreaming: false,
      clearQueue,
      abort,
      prompt: vi.fn(async (text: string, options: unknown) => {
        promptCalls.push({ text, options })
        if (promptCalls.length === 1) return firstTurn.promise
        return secondTurn.promise
      }),
    } as unknown as AgentSession

    await handlePrompt({ type: 'prompt', text: 'first prompt' }, () => {})
    // Simulate abort right after prompt enters preflight/run, then immediately send second prompt.
    const abortPromise = handleAbort({ type: 'abort' }, () => {})
    await handlePrompt({ type: 'prompt', text: 'second prompt' }, () => {})
    await abortPromise
    secondTurn.resolve()
    await st.activeTurnPromise

    expect(clearQueue).toHaveBeenCalled()
    expect(promptCalls).toHaveLength(2)
    expect(promptCalls[0]).toEqual({ text: 'first prompt', options: undefined })
    // Second prompt must start as a fresh turn (no streamingBehavior: 'followUp').
    expect(promptCalls[1]).toEqual({ text: 'second prompt', options: undefined })
  })

  it('auto-aborts an active turn when navigateTree receives abortIfBusy=true', async () => {
    const turnDone = deferred<void>()
    const navigateTree = vi.fn().mockResolvedValue({ cancelled: false, editorText: 'rewound text' })
    const abort = vi.fn().mockImplementation(async () => {
      st.agentTurnActive = false
      st.promptPreflightActive = false
      turnDone.resolve()
    })
    st.runtime = { navigateTree } as never
    st.session = {
      sessionId: 's1',
      sessionFile: '/sessions/s1.jsonl',
      isStreaming: false,
      thinkingLevel: 'medium',
      model: { provider: 'openai', id: 'gpt-5' },
      clearQueue: vi.fn(),
      abort,
      prompt: vi.fn(() => turnDone.promise),
      sessionManager: { getLeafId: () => 'leaf-1' },
    } as unknown as AgentSession

    await handlePrompt({ type: 'prompt', text: 'stuck turn' }, () => {})
    const replies: Array<Record<string, unknown>> = []
    await handleNavigatetree(
      { type: 'navigateTree', targetId: 'user-1', abortIfBusy: true },
      (r) => replies.push(r as Record<string, unknown>),
    )

    expect(abort).toHaveBeenCalledOnce()
    expect(navigateTree).toHaveBeenCalledWith('user-1', { summarize: false, label: undefined })
    expect(replies.at(-1)).toMatchObject({
      type: 'navigateTree-done',
      cancelled: false,
      editorText: 'rewound text',
      leafId: 'leaf-1',
    })
  })
})
