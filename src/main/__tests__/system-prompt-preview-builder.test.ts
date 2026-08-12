import { describe, expect, it, vi } from 'vitest'
import { buildSystemPromptPreview } from '../system-prompt-preview'

describe('buildSystemPromptPreview', () => {
  it('should_reject_unsupported_sdk_without_creating_a_session', async () => {
    await expect(buildSystemPromptPreview({}, 'C:/repo', {}, {})).rejects.toThrow(
      'Active Pi SDK does not support isolated system prompt preview',
    )
  })

  it('should_keep_project_resources_without_package_or_extension_side_effects', async () => {
    const reload = vi.fn().mockResolvedValue(undefined)
    const resourceLoader = { reload }
    const settingsManager = {}
    const fromStorage = vi.fn(() => settingsManager)
    const dispose = vi.fn()
    const DefaultResourceLoader = vi.fn(function () { return resourceLoader })
    const modelRuntime = {}
    const createModelRuntime = vi.fn().mockResolvedValue(modelRuntime)
    const sdk = {
      getAgentDir: vi.fn(() => 'C:/agent'),
      SettingsManager: { fromStorage },
      DefaultResourceLoader,
      SessionManager: {
        inMemory: vi.fn(() => ({ inMemory: true })),
      },
      ModelRuntime: {
        create: createModelRuntime,
      },
      createAgentSession: vi.fn().mockResolvedValue({
        session: { systemPrompt: 'assembled prompt', dispose },
      }),
    }

    await expect(buildSystemPromptPreview(
      sdk,
      'C:/repo',
      {
        defaultProvider: 'openai',
        packages: ['npm:global-package-that-must-not-install'],
        extensions: ['C:/agent/extensions/global.ts'],
      },
      {
        skills: ['.pi/skills/project-skill'],
        prompts: ['.pi/prompts/project-prompt.md'],
        packages: ['npm:project-package-that-must-not-install'],
        extensions: ['.pi/extensions/project.ts'],
      },
    )).resolves.toBe('assembled prompt')

    expect(fromStorage).toHaveBeenCalledWith(expect.objectContaining({
      withLock: expect.any(Function),
    }), { projectTrusted: true })
    const storage = (fromStorage.mock.calls as unknown as Array<[unknown]>)[0]?.[0] as {
      withLock: (
        scope: 'global' | 'project',
        fn: (current?: string) => string | undefined,
      ) => void
    }
    const values = new Map<string, string | undefined>()
    storage.withLock('global', (current) => {
      values.set('global', current)
      return current
    })
    storage.withLock('project', (current) => {
      values.set('project', current)
      return current
    })
    expect(JSON.parse(values.get('global') || '{}')).toEqual({
      defaultProvider: 'openai',
      packages: [],
      extensions: [],
    })
    expect(JSON.parse(values.get('project') || '{}')).toEqual({
      skills: ['.pi/skills/project-skill'],
      prompts: ['.pi/prompts/project-prompt.md'],
      packages: [],
      extensions: [],
    })
    expect(DefaultResourceLoader).toHaveBeenCalledWith(expect.objectContaining({
      cwd: 'C:/repo',
      agentDir: 'C:/agent',
      settingsManager,
      noExtensions: true,
      noPromptTemplates: true,
      noThemes: true,
    }))
    expect(reload).toHaveBeenCalledTimes(1)
    expect(sdk.SessionManager.inMemory).toHaveBeenCalledWith('C:/repo')
    expect(createModelRuntime).toHaveBeenCalledWith(expect.objectContaining({
      modelsPath: null,
      allowModelNetwork: false,
      credentials: expect.objectContaining({
        read: expect.any(Function),
        list: expect.any(Function),
        modify: expect.any(Function),
        delete: expect.any(Function),
      }),
      modelsStore: expect.objectContaining({
        read: expect.any(Function),
        write: expect.any(Function),
        delete: expect.any(Function),
      }),
    }))
    expect(sdk.createAgentSession).toHaveBeenCalledWith(expect.objectContaining({ modelRuntime }))
    expect(dispose).toHaveBeenCalledTimes(1)
  })
})
