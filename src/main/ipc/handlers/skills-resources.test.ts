import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (request: Record<string, unknown>) => Promise<unknown>>(),
  getSystemPrompt: vi.fn(),
  getContextPrompts: vi.fn(),
  getPromptTemplatesList: vi.fn(),
  reloadResources: vi.fn(),
  start: vi.fn(),
  listAgentsContextFiles: vi.fn(() => []),
  listPiBuiltinPromptFiles: vi.fn(() => []),
  listPluginInjectedPromptFiles: vi.fn(() => []),
  listPromptsOnDisk: vi.fn(() => []),
  workerManager: {
    isRunning: false,
    cwd: '',
  },
}))

vi.mock('../registry', () => ({
  registerHandler: (channel: string, handler: (request: Record<string, unknown>) => Promise<unknown>) => {
    mocks.handlers.set(channel, handler)
  },
}))
vi.mock('../../worker-manager', () => ({
  workerManager: Object.assign(mocks.workerManager, {
    getContextPrompts: mocks.getContextPrompts,
    getPromptTemplatesList: mocks.getPromptTemplatesList,
    reloadResources: mocks.reloadResources,
    start: mocks.start,
  }),
}))
vi.mock('../../config-store', () => ({
  configStore: {
    get: vi.fn((key: string) => key === 'currentProject' ? 'C:/repo' : undefined),
    getSkillOverrides: vi.fn(() => ({})),
    set: vi.fn(),
  },
}))
vi.mock('../../session-preview-process', () => ({
  sessionPreviewProcess: { getSystemPrompt: mocks.getSystemPrompt },
}))
vi.mock('../../pi-agent-settings-read', () => ({
  readPiAgentGlobalSettingsFromDisk: vi.fn(() => ({ defaultProvider: 'openai' })),
  readPiProjectSettingsFromDisk: vi.fn(() => ({ skills: ['.pi/skills/project-skill'] })),
}))
vi.mock('../../pi-resources-editor', () => ({
  listSkillsOnDisk: vi.fn(() => []),
  listPromptsOnDisk: mocks.listPromptsOnDisk,
  readTextFileSafe: vi.fn(),
  writeTextFileSafe: vi.fn(),
  skillStorageKey: vi.fn(() => 'skill'),
}))
vi.mock('../../pi-skill-overrides', () => ({
  getDesktopSkillOverrides: vi.fn(() => ({})),
  isSkillEnabled: vi.fn(() => true),
  setSkillEnabledInGlobal: vi.fn(() => ({})),
  applySkillOverridesBatch: vi.fn(),
  migrateElectronSkillOverrides: vi.fn(),
}))
vi.mock('../../pi-prompt-catalog', () => ({
  listAgentsContextFiles: mocks.listAgentsContextFiles,
  listPiBuiltinPromptFiles: mocks.listPiBuiltinPromptFiles,
  listPluginInjectedPromptFiles: mocks.listPluginInjectedPromptFiles,
  groupPromptCatalog: vi.fn(() => ({})),
  getGlobalSystemMd: vi.fn(() => 'C:/agent/SYSTEM.md'),
}))
vi.mock('../../resource-revisions', () => ({
  listRevisions: vi.fn(() => []),
  pushRevision: vi.fn(),
  restoreRevision: vi.fn(),
  readRevision: vi.fn(),
}))

import { registerSkillsResourceHandlers } from './skills-resources'

describe('system prompt resource preview', () => {
  beforeEach(() => {
    mocks.handlers.clear()
    mocks.getSystemPrompt.mockReset().mockResolvedValue('assembled prompt')
    mocks.getContextPrompts.mockReset()
    mocks.getPromptTemplatesList.mockReset().mockResolvedValue([])
    mocks.reloadResources.mockReset()
    mocks.start.mockReset()
    mocks.listAgentsContextFiles.mockClear()
    mocks.listPiBuiltinPromptFiles.mockClear()
    mocks.listPluginInjectedPromptFiles.mockClear()
    mocks.listPromptsOnDisk.mockClear()
    mocks.workerManager.isRunning = false
    mocks.workerManager.cwd = ''
    registerSkillsResourceHandlers()
  })

  it('uses the isolated preview process while the session worker is idle', async () => {
    const handler = mocks.handlers.get('ipc:resource.read')
    await expect(handler?.({ path: 'pi-desktop://system-prompt-preview' })).resolves.toEqual({
      content: 'assembled prompt',
      path: 'pi-desktop://system-prompt-preview',
      revisions: [],
    })

    expect(mocks.getSystemPrompt).toHaveBeenCalledWith({
      cwd: 'C:/repo',
      globalSettings: { defaultProvider: 'openai' },
      projectSettings: { skills: ['.pi/skills/project-skill'] },
    })
    expect(mocks.start).not.toHaveBeenCalled()
    expect(mocks.getContextPrompts).not.toHaveBeenCalled()
  })

  it('does not reuse a live worker from another project', async () => {
    mocks.workerManager.isRunning = true
    mocks.workerManager.cwd = 'C:/project-a'
    const handler = mocks.handlers.get('ipc:resource.read')

    await expect(handler?.({ path: 'pi-desktop://system-prompt-preview' })).resolves.toEqual({
      content: 'assembled prompt',
      path: 'pi-desktop://system-prompt-preview',
      revisions: [],
    })

    expect(mocks.getSystemPrompt).toHaveBeenCalledWith(expect.objectContaining({ cwd: 'C:/repo' }))
    expect(mocks.getContextPrompts).not.toHaveBeenCalled()
  })

  it('does not build the prompt catalog from another project worker', async () => {
    mocks.workerManager.isRunning = true
    mocks.workerManager.cwd = 'C:/project-a'
    const handler = mocks.handlers.get('ipc:prompts.list')

    await handler?.({})

    expect(mocks.listAgentsContextFiles).toHaveBeenCalledWith('C:/repo')
    expect(mocks.listPiBuiltinPromptFiles).toHaveBeenCalledWith('C:/repo', true)
    expect(mocks.listPluginInjectedPromptFiles).toHaveBeenCalledWith('C:/repo')
    expect(mocks.listPromptsOnDisk).toHaveBeenCalledWith('C:/repo')
    expect(mocks.getContextPrompts).not.toHaveBeenCalled()
    expect(mocks.getPromptTemplatesList).not.toHaveBeenCalled()
  })
})
