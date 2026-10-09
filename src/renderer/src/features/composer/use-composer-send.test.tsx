import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useUIStore } from '@renderer/stores/ui-store'
import { renderRichFromSegments, serializeRichInput } from './attachments'
import { clearTransientComposerDraft, readTransientComposerDraft } from './composer-transient-draft'

const mocks = vi.hoisted(() => ({
  invoke: vi.fn<(method: string, request?: unknown) => Promise<unknown>>(async () => ({})),
  appendOptimistic: vi.fn<(text: string, opts?: unknown) => {
    sessionFile: string
    assistantId: string
  } | null>(() => ({
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

vi.mock('./delayed-tooltip', () => ({ hideAllDelayedTooltips: vi.fn(), wireDelayedTooltip: vi.fn() }))

import { useComposerSend } from './use-composer-send'

function createEditor(text: string): HTMLDivElement {
  const editor = document.createElement('div')
  editor.textContent = text
  return editor
}

function renderSender(input: string | HTMLDivElement) {
  const editor = typeof input === 'string' ? createEditor(input) : input
  const text = serializeRichInput(editor).displayText
  const updateFromEditor = vi.fn()
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
    updateFromEditor,
    ...renderHook(() => useComposerSend({
      editorRef: { current: editor },
      text,
      attachments: [],
      updateFromEditor,
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
    mocks.clearOptimistic.mockReturnValue(true)
    mocks.afterPromptSent.mockReset().mockResolvedValue()
    for (const key of ['pending:D:/workspace', 'file:C:/sessions/current.jsonl', 'file:C:/sessions/new.jsonl']) {
      clearTransientComposerDraft(key)
    }
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
  it('sends the first prompt to a new session while another session is running', async () => {
    useUIStore.setState({
      currentSessionId: '__pending_new__',
      historySessionFile: null,
      pendingNewSessionPlaceholder: true,
      sessionRuntimeRunning: { 'C:/sessions/running.jsonl': true },
      runState: { status: 'idle', toolCount: 0, errorCount: 0 },
    })
    mocks.invoke.mockImplementation(async (method) => {
      if (method === 'session.new') {
        return { session: { sessionId: 'new', sessionFile: 'C:/sessions/new.jsonl' } }
      }
      return {}
    })
    const { result } = renderSender(createEditor('first prompt'))

    await act(() => result.current.sendCurrent())

    expect(mocks.bindOptimistic).toHaveBeenCalledWith(expect.anything(), 'C:/sessions/new.jsonl')
    expect(mocks.invoke).toHaveBeenCalledWith('prompt.send', expect.objectContaining({
      sessionFile: 'C:/sessions/new.jsonl', text: 'first prompt',
    }))
    expect(mocks.invoke).not.toHaveBeenCalledWith('prompt.steer', expect.anything())
    expect(useUIStore.getState().sessionRuntimeRunning['C:/sessions/running.jsonl']).toBe(true)
    expect(useUIStore.getState().sessions).toEqual(expect.arrayContaining([
      expect.objectContaining({ sessionId: 'new', title: 'first prompt' }),
    ]))
  })

  it.each([true, false])('restores a failed new-session draft with attachments (text: %s)', async (withText) => {
    useUIStore.setState({
      currentSessionId: '__pending_new__',
      historySessionFile: null,
      pendingNewSessionPlaceholder: true,
    })
    mocks.invoke.mockRejectedValue(new Error('SESSION_NEW_CANCELLED'))
    if (!withText) mocks.appendOptimistic.mockReturnValueOnce(null)
    const editor = createEditor('')
    renderRichFromSegments(editor, [
      { type: 'text', text: withText ? 'first prompt\nwith attachment ' : '' },
      { type: 'file', attachment: { path: '/workspace/example.ts', name: 'example.ts', kind: 'code' } },
    ])
    const original = serializeRichInput(editor)
    const { result, updateFromEditor } = renderSender(editor)

    await act(() => result.current.sendCurrent())

    expect(serializeRichInput(editor).payload).toBe(original.payload)
    expect(serializeRichInput(editor).attachments).toEqual(original.attachments)
    expect(updateFromEditor).toHaveBeenCalledTimes(2)
    expect(readTransientComposerDraft('pending:D:/workspace')).not.toBeNull()
    expect(mocks.invoke).not.toHaveBeenCalledWith('prompt.send', expect.anything())
  })

  it('keeps a newer draft when restoring a rejected prompt', async () => {
    const editor = createEditor('rejected prompt')
    mocks.invoke.mockImplementation(async () => {
      editor.textContent = 'new draft'
      throw new Error('Worker exited')
    })
    const { result } = renderSender(editor)

    await act(() => result.current.sendCurrent())

    expect(serializeRichInput(editor).displayText).toBe('rejected prompt\nnew draft')
  })

  it('does not restore into a different session after switching away', async () => {
    const editor = createEditor('original prompt')
    mocks.clearOptimistic.mockReturnValue(false)
    mocks.invoke.mockImplementation(async () => {
      useUIStore.setState({ currentSessionId: 'other', historySessionFile: 'C:/sessions/other.jsonl' })
      editor.textContent = 'other session draft'
      throw new Error('Worker exited')
    })
    const { result } = renderSender(editor)

    await act(() => result.current.sendCurrent())

    expect(serializeRichInput(editor).displayText).toBe('other session draft')
    expect(readTransientComposerDraft('file:C:/sessions/current.jsonl')).toEqual([
      { type: 'text', text: 'original prompt' },
    ])
  })

  it('keeps the failed draft with its created session when model selection fails', async () => {
    useUIStore.setState({
      currentSessionId: '__pending_new__',
      historySessionFile: null,
      pendingNewSessionPlaceholder: true,
      runState: { status: 'idle', toolCount: 0, errorCount: 0, model: 'openai/missing' },
    })
    mocks.invoke.mockImplementation(async (method) => {
      if (method === 'session.new') {
        return { session: { sessionId: 'new', sessionFile: 'C:/sessions/new.jsonl' } }
      }
      if (method === 'model.set') throw new Error('MODEL_NOT_FOUND')
      return {}
    })
    const editor = createEditor('first prompt')
    const { result } = renderSender(editor)

    await act(() => result.current.sendCurrent())

    expect(readTransientComposerDraft('file:C:/sessions/new.jsonl')).toEqual([
      { type: 'text', text: 'first prompt' },
    ])
    expect(serializeRichInput(editor).displayText).toBe('first prompt')
    expect(mocks.invoke).not.toHaveBeenCalledWith('prompt.send', expect.anything())
  })

  it('does not roll back a prompt accepted before display refresh fails', async () => {
    mocks.afterPromptSent.mockRejectedValue(new Error('Display refresh failed'))
    const editor = createEditor('accepted prompt')
    const { result } = renderSender(editor)

    await act(() => result.current.sendCurrent())

    expect(mocks.clearOptimistic).not.toHaveBeenCalled()
    expect(serializeRichInput(editor).displayText).toBe('')
  })
})
