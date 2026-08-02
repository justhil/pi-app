import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  readModelsConfigWithSdk,
  writeModelsConfigWithSdk,
  type PiModelsConfig,
} from './pi-models-json'

const tempDirs: string[] = []

function createSdk(getError?: () => string | undefined) {
  return {
    ModelRuntime: {
      create: vi.fn(async () => ({ getError: getError || (() => undefined) })),
    },
  }
}

function createRegistrySdk() {
  return {
    AuthStorage: { create: vi.fn(() => ({})) },
    ModelRegistry: { create: vi.fn(() => ({ getError: () => undefined })) },
  }
}

function createAgentDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'pi-model-config-'))
  tempDirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('active SDK model config persistence', () => {
  it('writes provider config to the active SDK agent dir without rewriting values', async () => {
    const agentDir = createAgentDir()
    const sdk = createSdk()
    const draft: PiModelsConfig = {
      providers: {
        custom: {
          name: ' Custom ',
          baseUrl: ' https://example.invalid/v1/ ',
          api: 'openai-completions',
          apiKey: '$TEST_API_KEY',
          models: [{ id: ' model-a ', name: ' Model A ', contextWindow: 8192, maxTokens: 2048 }],
        },
      },
    }

    await expect(writeModelsConfigWithSdk(draft, sdk, agentDir)).resolves.toEqual({
      ok: true,
      path: join(agentDir, 'models.json'),
    })

    const reloaded = await readModelsConfigWithSdk(sdk, agentDir)
    expect(reloaded.config).toEqual(draft)
    expect(readFileSync(join(agentDir, 'models.json'), 'utf8')).not.toContain('sk-test')
  })

  it('preserves the full SDK document when editing one owned model field', async () => {
    const agentDir = createAgentDir()
    const sdk = createSdk()
    const fixture = {
      version: 1,
      providers: {
        oauth: {
          name: 'OAuth provider',
          api: 'mistral-conversations',
          oauth: 'radius',
          baseUrl: 'https://provider.invalid/v1',
          headers: { 'x-provider': 'keep' },
          compat: { supportsDeveloperRole: false },
          models: [
            {
              id: 'model-a',
              name: 'Model A',
              api: 'mistral-conversations',
              baseUrl: 'https://model.invalid/v1',
              headers: { 'x-model': 'keep' },
              compat: { requiresThinkingAsText: true },
              cost: {
                input: 1,
                output: 2,
                cacheRead: 0.5,
                cacheWrite: 0.25,
                tiers: [{ inputTokensAbove: 1000, input: 0.5, output: 1, cacheRead: 0.2, cacheWrite: 0.1 }],
              },
              reasoning: true,
              thinkingLevelMap: { off: 'low', high: null, xhigh: 'high' },
              contextWindow: 8192,
              maxTokens: 2048,
            },
          ],
          modelOverrides: {
            'model-a': { cost: { input: 9 }, compat: { supportsStrictMode: true } },
          },
        },
      },
    }
    writeFileSync(join(agentDir, 'models.json'), `${JSON.stringify(fixture, null, 2)}\n`, 'utf8')

    const read = await readModelsConfigWithSdk(sdk, agentDir)
    const retainedProvider = read.config.providers.oauth
    const draft: PiModelsConfig = {
      providers: {
        oauth: {
          name: retainedProvider.name,
          api: retainedProvider.api,
          baseUrl: retainedProvider.baseUrl,
          apiKey: retainedProvider.apiKey,
          authHeader: retainedProvider.authHeader,
          models: retainedProvider.models?.map((model) => ({
            id: model.id,
            name: model.name,
            api: model.api,
            reasoning: model.reasoning,
            input: model.input,
            contextWindow: model.id === 'model-a' ? 16384 : model.contextWindow,
            maxTokens: model.maxTokens,
            thinkingLevelMap: model.thinkingLevelMap,
          })),
        },
      },
    }

    await expect(writeModelsConfigWithSdk(draft, sdk, agentDir)).resolves.toEqual({
      ok: true,
      path: join(agentDir, 'models.json'),
    })

    const saved = JSON.parse(readFileSync(join(agentDir, 'models.json'), 'utf8'))
    expect(saved).toEqual({
      ...fixture,
      providers: {
        ...fixture.providers,
        oauth: {
          ...fixture.providers.oauth,
          models: [{ ...fixture.providers.oauth.models[0], contextWindow: 16384 }],
        },
      },
    })
  })

  it('preserves null thinking mappings and unknown nested fields during read projection', async () => {
    const agentDir = createAgentDir()
    const sdk = createSdk()
    const fixture = {
      providers: {
        custom: {
          models: [{ id: 'model-a', thinkingLevelMap: { high: null, max: 'max' }, futureModelField: { keep: true } }],
          futureProviderField: ['keep'],
        },
      },
    }
    writeFileSync(join(agentDir, 'models.json'), JSON.stringify(fixture), 'utf8')

    const read = await readModelsConfigWithSdk(sdk, agentDir)

    expect(read.config.providers.custom).toEqual(fixture.providers.custom)
  })

  it('writes provider config with the current registry validation API', async () => {
    const agentDir = createAgentDir()
    const sdk = createRegistrySdk()
    const draft: PiModelsConfig = {
      providers: {
        custom: {
          baseUrl: 'https://example.invalid/v1',
          api: 'openai-completions',
          models: [{ id: 'model-a' }],
        },
      },
    }

    await expect(writeModelsConfigWithSdk(draft, sdk, agentDir)).resolves.toEqual({
      ok: true,
      path: join(agentDir, 'models.json'),
    })
    expect(sdk.ModelRegistry.create).toHaveBeenCalledOnce()
    expect(readFileSync(join(agentDir, 'models.json'), 'utf8')).toContain('model-a')
  })

  it('rejects save when the retained file cannot be parsed', async () => {
    const agentDir = createAgentDir()
    const path = join(agentDir, 'models.json')
    writeFileSync(path, '{ broken json', 'utf8')
    const sdk = createSdk()

    await expect(
      writeModelsConfigWithSdk({ providers: { custom: { models: [{ id: 'new' }] } } }, sdk, agentDir),
    ).resolves.toMatchObject({ ok: false, path, error: expect.stringContaining('原 models.json 无法解析，未写入') })

    expect(readFileSync(path, 'utf8')).toBe('{ broken json')
    expect(sdk.ModelRuntime.create).not.toHaveBeenCalled()
  })

  it('passes structurally invalid provider and model entries to the active SDK', async () => {
    const agentDir = createAgentDir()
    let validatedConfig: unknown
    const sdk = {
      ModelRuntime: {
        create: vi.fn(async (options: { modelsPath: string }) => {
          validatedConfig = JSON.parse(readFileSync(options.modelsPath, 'utf8'))
          return { getError: () => 'invalid structure' }
        }),
      },
    }
    const draft = {
      providers: {
        broken: 'not-an-object',
        custom: { models: ['not-an-object'] },
      },
    } as unknown as PiModelsConfig

    await expect(writeModelsConfigWithSdk(draft, sdk, agentDir)).resolves.toMatchObject({
      ok: false,
      error: 'invalid structure',
    })

    expect(validatedConfig).toEqual(draft)
  })

  it('passes invalid advanced fields to the active SDK instead of deleting them', async () => {
    const agentDir = createAgentDir()
    let validatedConfig: unknown
    const sdk = {
      ModelRuntime: {
        create: vi.fn(async (options: { modelsPath: string }) => {
          validatedConfig = JSON.parse(readFileSync(options.modelsPath, 'utf8'))
          return { getError: () => 'invalid cost' }
        }),
      },
    }
    const draft = {
      providers: {
        custom: {
          models: [{ id: 'model-a', cost: 'invalid' }],
        },
      },
    } as unknown as PiModelsConfig

    await expect(writeModelsConfigWithSdk(draft, sdk, agentDir)).resolves.toMatchObject({
      ok: false,
      error: 'invalid cost',
    })

    expect(sdk.ModelRuntime.create).toHaveBeenCalledOnce()
    expect((validatedConfig as { providers: { custom: { models: { cost: unknown }[] } } }).providers.custom.models[0].cost)
      .toBe('invalid')
  })

  it('does not write invalid config or leave a temporary file after SDK rejection', async () => {
    const agentDir = createAgentDir()
    const original = JSON.stringify({ providers: { custom: { models: [{ id: 'old' }] } } }, null, 2) + '\n'
    writeFileSync(join(agentDir, 'models.json'), original, 'utf8')
    const sdk = createSdk(() => 'invalid provider config')

    await expect(
      writeModelsConfigWithSdk({ providers: { custom: { models: [{ id: 'new' }] } } }, sdk, agentDir),
    ).resolves.toMatchObject({ ok: false, error: 'invalid provider config' })

    expect(readFileSync(join(agentDir, 'models.json'), 'utf8')).toBe(original)
    expect(readdirSync(agentDir).filter((name) => name.endsWith('.tmp'))).toEqual([])
  })

  it('redacts literal api keys from active SDK validation errors', async () => {
    const agentDir = createAgentDir()
    const sdk = createSdk(() => 'invalid apiKey secret-api-key')

    await expect(
      writeModelsConfigWithSdk(
        { providers: { custom: { apiKey: 'secret-api-key', models: [{ id: 'model-a' }] } } },
        sdk,
        agentDir,
      ),
    ).resolves.toMatchObject({ ok: false, error: 'invalid apiKey [REDACTED]' })
  })

  it('does not include api keys in normalization diagnostics', async () => {
    const agentDir = createAgentDir()
    const sdk = createSdk()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    try {
      await writeModelsConfigWithSdk(
        { providers: { custom: { apiKey: 'secret-api-key', models: [{ id: 'model-a' }, { id: 'model-a' }] } } },
        sdk,
        agentDir,
      )
      expect(warn.mock.calls.flat().join(' ')).not.toContain('secret-api-key')
    } finally {
      warn.mockRestore()
    }
  })
})
