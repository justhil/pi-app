import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => 'C:/Users/test/AppData/Roaming/pi-desktop') },
  utilityProcess: { fork: vi.fn() },
}))
vi.mock('../sdk-loader', () => ({
  resolveActiveSdk: vi.fn(() => ({ kind: 'builtin', entryPath: '@earendil-works/pi-coding-agent' })),
}))
vi.mock('../wsl/runtime-config', () => ({
  isWslRuntimeActive: vi.fn(() => false),
}))
vi.mock('../operation-events', () => ({ emitOperationEvent: vi.fn() }))

import { SessionPreviewProcess } from '../session-preview-process'

describe('SessionPreviewProcess system prompt preview', () => {
  it('should_route_system_prompt_preview_without_session_worker_when_requested', () => {
    const preview = new SessionPreviewProcess()
    const request = vi.spyOn(
      preview as unknown as { request: (type: string, payload: Record<string, unknown>) => Promise<unknown> },
      'request',
    ).mockResolvedValue('preview')

    void preview.getSystemPrompt({
      cwd: 'C:/repo',
      globalSettings: { defaultModel: 'gpt-5' },
      projectSettings: { skills: ['.pi/skills/project-skill'] },
    })

    expect(request).toHaveBeenCalledWith('system.prompt', {
      cwd: 'C:/repo',
      globalSettings: { defaultModel: 'gpt-5' },
      projectSettings: { skills: ['.pi/skills/project-skill'] },
    })
  })
})
