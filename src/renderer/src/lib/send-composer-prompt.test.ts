import { beforeEach, describe, expect, it, vi } from 'vitest'

const invoke = vi.fn()
const afterPromptSent = vi.fn()
const materializePendingNewSession = vi.fn()
let storeState: {
  currentSessionId: string | null
  historySessionFile: string | null
  pendingNewSessionPlaceholder: boolean
  currentWorkspace: string | null
}

vi.mock('@renderer/lib/ipc-client', () => ({
  ipcClient: { invoke: (...args: unknown[]) => invoke(...args) },
}))
vi.mock('@renderer/lib/after-prompt-sent', () => ({
  afterPromptSent: (...args: unknown[]) => afterPromptSent(...args),
}))
vi.mock('@renderer/lib/new-session', () => ({
  materializePendingNewSession: (...args: unknown[]) => materializePendingNewSession(...args),
}))
vi.mock('@renderer/stores/ui-store', () => ({
  useUIStore: {
    getState: () => storeState,
  },
}))

describe('sendComposerPrompt', () => {
  beforeEach(() => {
    invoke.mockReset()
    afterPromptSent.mockReset()
    materializePendingNewSession.mockReset()
    invoke.mockResolvedValue({ ok: true })
    afterPromptSent.mockResolvedValue(undefined)
    materializePendingNewSession.mockImplementation(async (_workspace: string, _text: string, onCreated?: (file: string) => void) => {
      storeState = {
        currentSessionId: 'new',
        historySessionFile: '/tmp/new.jsonl',
        pendingNewSessionPlaceholder: false,
        currentWorkspace: '/proj',
      }
      onCreated?.('/tmp/new.jsonl')
    })
    storeState = {
      currentSessionId: 's1',
      historySessionFile: '/tmp/a.jsonl',
      pendingNewSessionPlaceholder: false,
      currentWorkspace: '/proj',
    }
  })

  it('sends current session file and waits for bind', async () => {
    const { sendComposerPrompt } = await import('./send-composer-prompt')
    await expect(sendComposerPrompt('请按这些行评修改')).resolves.toBe(true)
    expect(invoke).toHaveBeenCalledWith('prompt.send', {
      sessionId: 's1',
      sessionFile: '/tmp/a.jsonl',
      text: '请按这些行评修改',
    })
    expect(afterPromptSent).toHaveBeenCalled()
  })

  it('should_materialize_pending_new_session_before_sending_review_prompt', async () => {
    storeState = {
      currentSessionId: '__pending_new__',
      historySessionFile: null,
      pendingNewSessionPlaceholder: true,
      currentWorkspace: '/proj',
    }
    const { sendComposerPrompt } = await import('./send-composer-prompt')
    await expect(sendComposerPrompt('请按这些行评修改')).resolves.toBe(true)
    expect(materializePendingNewSession).toHaveBeenCalledWith('/proj', '请按这些行评修改')
    expect(invoke).toHaveBeenCalledWith('prompt.send', {
      sessionId: 'new',
      sessionFile: '/tmp/new.jsonl',
      text: '请按这些行评修改',
    })
  })
})
