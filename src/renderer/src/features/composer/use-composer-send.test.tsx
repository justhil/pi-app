import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useUIStore } from '@renderer/stores/ui-store'

const mocks = vi.hoisted(() => ({
  invoke: vi.fn<(method: string, request?: unknown) => Promise<unknown>>(async () => ({})),
  appendOptimistic: vi.fn<(text: string, opts?: unknown) => {
    sessionFile: string
    assistantId: string
  }>(() => ({
    sessionFile: 'C:/sessions/current.jsonl',
    assistantId: 'opt-asst-1',
  })),
  bindOptimistic: vi.fn<(token: unknown, sessionFile: string | null) => void>(),
  clearOptimistic: vi.fn<(token: unknown) => boolean>(() => true),
  afterPromptSent: vi.fn<(bind?: unknown) => Promise<void>>(async () => {}),
  turnActive: vi.fn(() => false),
  routeSlash: vi.fn(async () => ({ handled: false })),
}))

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-i18next')>()
  return {
    ...actual,
    useTranslation: () => ({ t: (key: string) => key }),
  }
})

vi.mock('@renderer/lib/ipc-client', () => ({
  ipcClient: { invoke: (method: string, request?: unknown) => mocks.invoke(method, request) },
}))

vi.mock('@renderer/lib/session-worker-sync', () => ({
  composerTurnActive: () => mocks.turnActive(),
}))

vi.mock('@renderer/lib/optimistic-send', () => ({
  appendOptimisticOutgoingMessage: (text: string, opts?: unknown) =>
    mocks.appendOptimistic(text, opts),
  bindOptimisticOutgoingToSession: (token: unknown, sessionFile: string | null) =>
    mocks.bindOptimistic(token, sessionFile),
  clearOptimisticOutgoing: (token: unknown) => mocks.clearOptimistic(token),
}))

vi.mock('@renderer/lib/after-prompt-sent', () => ({
  afterPromptSent: (bind?: unknown) => mocks.afterPromptSent(bind),
}))

vi.mock('@renderer/lib/slash-desktop-router', () => ({
  routeDesktopSlashBeforeSend: () => mocks.routeSlash(),
}))

vi.mock('@renderer/lib/composer-run-display', () => ({ refreshComposerRunDisplay: vi.fn() }))

vi.mock('@renderer/lib/composer-abort', () => ({
  abortAgentTurn: vi.fn(async () => {}),
  isComposerAbortCooldown: () => false,
}))

vi.mock('@renderer/stores/extension-ui-store', () => ({
  extensionUiBlocksComposer: () => false,
}))

vi.mock('./delayed-tooltip', () => ({ hideAllDelayedTooltips: vi.fn() }))

import { useComposerSend } from './use-composer-send'

function createEditor(text: string): HTMLDivElement {
  const editor = document.createElement('div')
  editor.textContent = text
  return editor
}

function renderSender(text: string) {
  const editor = createEditor(text)
  const inputHistory = {
    recordSent: vi.fn(),
    tryArrowUp: vi.fn(),
    tryArrowDown: vi.fn(),
    onUserEdit: vi.fn(),
    onComposerBlur: vi.fn(),
    resetNav: vi.fn(),
  }
  return {
    inputHistory,
    ...renderHook(() => useComposerSend({
      editorRef: { current: editor },
      text,
      attachments: [],
      updateFromEditor: vi.fn(),
      clearEditor: vi.fn(),
      setContent: vi.fn(),
      inputHistory,
      refreshCommands: vi.fn(async () => {}),
      showComposerStop: false,
      isRunning: false,
    })),
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

describe('useComposerSend submission arbitration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.invoke.mockReset()
    mocks.invoke.mockResolvedValue({})
    mocks.turnActive.mockReturnValue(false)
    mocks.routeSlash.mockResolvedValue({ handled: false })
    useUIStore.setState({
      currentWorkspace: 'D:/workspace',
      currentSessionId: 'session-1',
      historySessionFile: 'C:/sessions/current.jsonl',
      timelineItems: [],
      pendingNewSessionPlaceholder: false,
      ephemeralSandboxDraft: false,
      workerLiveSnapshot: {
        sessionId: 'session-1',
        sessionFile: 'C:/sessions/current.jsonl',
        status: 'idle',
      },
      sessionRuntimeRunning: {},
      sessions: [],
      sessionsWorkspace: 'D:/workspace',
      runState: { status: 'idle', model: 'openai/test-model', thinkingLevel: 'high', toolCount: 0, errorCount: 0 },
    })
  })

  it('should_send_only_once_when_submit_reenters_before_editor_clear', async () => {
    const { result, inputHistory } = renderSender('hello')

    await act(async () => {
      const first = result.current.sendCurrent()
      const second = result.current.sendCurrent()
      await Promise.all([first, second])
    })

    expect(mocks.appendOptimistic).toHaveBeenCalledTimes(1)
    expect(
      mocks.invoke.mock.calls.filter((call) => call[0] === 'prompt.send'),
    ).toHaveLength(1)
    expect(inputHistory.recordSent).toHaveBeenCalledTimes(1)
  })

  it.each(['project', 'home', 'sandbox'] as const)(
    'should_keep_the_created_%s_session_as_the_first_prompt_target_during_navigation',
    async (kind) => {
      const model = deferred<{ modelId: string }>()
      useUIStore.setState({
        currentSessionId: kind === 'home' ? null : '__pending_new__',
        historySessionFile: null,
        pendingNewSessionPlaceholder: kind === 'project',
        ephemeralSandboxDraft: kind === 'sandbox',
        ...(kind === 'sandbox' ? { currentWorkspace: null } : {}),
        sessionRuntimeRunning: { 'C:/sessions/current.jsonl': true },
      })
      mocks.invoke.mockImplementation(async (method) => {
        if (method === 'workspace.sandbox.create') return { sandbox: { path: 'D:/sandbox', label: 'Sandbox' } }
        if (method === 'session.new') return { session: { sessionId: 'new-id', sessionFile: 'C:/sessions/new.jsonl' } }
        if (method === 'model.set') return model.promise
        if (method === 'session.list') return { sessions: [] }
        return {}
      })
      const { result } = renderSender('first prompt')
      let sending!: Promise<void>
      act(() => { sending = result.current.sendCurrent() })
      await vi.waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith('model.set', expect.objectContaining({
        sessionFile: 'C:/sessions/new.jsonl',
      })))

      await act(async () => {
        useUIStore.setState({ currentSessionId: 'session-1', historySessionFile: 'C:/sessions/current.jsonl' })
        model.resolve({ modelId: 'openai/test-model' })
        await sending
      })

      expect(mocks.invoke).toHaveBeenCalledWith('prompt.send', expect.objectContaining({
        sessionFile: 'C:/sessions/new.jsonl', text: 'first prompt',
      }))
      expect(mocks.bindOptimistic).toHaveBeenCalledWith(expect.anything(), 'C:/sessions/new.jsonl')
      expect(useUIStore.getState().sessions.find((s) => s.sessionId === 'new-id')?.title).toBe('first prompt')
    },
  )

  it.each([undefined, 'steer', 'followUp'] as const)(
    'should_keep_the_original_session_as_the_target_for_%s_submission',
    async (queue) => {
      const routed = deferred<{ handled: boolean }>()
      mocks.routeSlash.mockReturnValue(routed.promise)
      mocks.turnActive.mockReturnValue(queue !== undefined)
      const { result } = renderSender('/extension-command')
      let sending!: Promise<void>
      act(() => { sending = result.current.sendCurrent(queue ? { queue } : undefined) })
      await vi.waitFor(() => expect(mocks.routeSlash).toHaveBeenCalled())

      await act(async () => {
        useUIStore.setState({ currentSessionId: 'other-id', historySessionFile: 'C:/sessions/other.jsonl' })
        routed.resolve({ handled: false })
        await sending
      })

      const method = queue === 'steer' ? 'prompt.steer' : queue === 'followUp' ? 'prompt.followUp' : 'prompt.send'
      expect(mocks.invoke).toHaveBeenCalledWith(method, expect.objectContaining({
        sessionFile: 'C:/sessions/current.jsonl', text: '/extension-command',
      }))
    },
  )
})
