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
  composerTurnActive: () => false,
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
  routeDesktopSlashBeforeSend: vi.fn(async () => ({ handled: false })),
}))

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }))

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

describe('useComposerSend submission arbitration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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
    })
  })

  it('should_send_only_once_when_submit_reenters_before_editor_clear', async () => {
    const editor = createEditor('hello')
    const inputHistory = {
      recordSent: vi.fn(),
      tryArrowUp: vi.fn(),
      tryArrowDown: vi.fn(),
      onUserEdit: vi.fn(),
      onComposerBlur: vi.fn(),
      resetNav: vi.fn(),
    }
    const { result } = renderHook(() =>
      useComposerSend({
        editorRef: { current: editor },
        text: 'hello',
        attachments: [],
        updateFromEditor: vi.fn(),
        clearEditor: vi.fn(),
        setContent: vi.fn(),
        inputHistory,
        refreshCommands: vi.fn(async () => {}),
        showComposerStop: false,
        isRunning: false,
      }),
    )

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
})

describe('sendCurrent blocks pi builtins on the direct queue path', () => {
  it('never forwards an unimplemented pi builtin via prompt.followUp (Alt+Enter while running)', async () => {
    const editor = createEditor('/login anthropic')
    const inputHistory = {
      recordSent: vi.fn(),
      tryArrowUp: vi.fn(),
      tryArrowDown: vi.fn(),
      onUserEdit: vi.fn(),
      onComposerBlur: vi.fn(),
      resetNav: vi.fn(),
    }
    const { result } = renderHook(() =>
      useComposerSend({
        editorRef: { current: editor },
        text: '/login anthropic',
        attachments: [],
        updateFromEditor: vi.fn(),
        clearEditor: vi.fn(),
        setContent: vi.fn(),
        inputHistory,
        refreshCommands: vi.fn(async () => {}),
        showComposerStop: true,
        isRunning: true,
      }),
    )

    await act(async () => {
      await result.current.sendCurrent({ queue: 'followUp' })
    })

    expect(
      mocks.invoke.mock.calls.filter((call) => call[0] === 'prompt.followUp'),
    ).toHaveLength(0)
    expect(
      mocks.invoke.mock.calls.filter((call) => call[0] === 'prompt.steer'),
    ).toHaveLength(0)
  })
})
