import { beforeEach, describe, expect, it, vi } from 'vitest'

const invoke = vi.fn()
const afterPromptSent = vi.fn()

vi.mock('@renderer/lib/ipc-client', () => ({
  ipcClient: { invoke: (...args: unknown[]) => invoke(...args) },
}))
vi.mock('@renderer/lib/after-prompt-sent', () => ({
  afterPromptSent: (...args: unknown[]) => afterPromptSent(...args),
}))
vi.mock('@renderer/stores/ui-store', () => ({
  useUIStore: {
    getState: () => ({ currentSessionId: 's1', historySessionFile: '/tmp/a.jsonl' }),
  },
}))

describe('sendComposerPrompt', () => {
  beforeEach(() => {
    invoke.mockReset()
    afterPromptSent.mockReset()
    invoke.mockResolvedValue({ ok: true })
    afterPromptSent.mockResolvedValue(undefined)
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
})
