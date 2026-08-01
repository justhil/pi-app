import { mkdtempSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  readModelsConfigWithSdk,
  writeModelsConfigWithSdk,
  type PiModelsConfig,
} from './pi-models-json'

const tempDirs: string[] = []

function createSdk() {
  return {
    ModelRuntime: {
      create: vi.fn(async () => ({ getError: () => undefined })),
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
  it('writes the normalized provider config to the active SDK agent dir and reloads it', async () => {
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
    expect(reloaded.config).toEqual({
      providers: {
        custom: {
          name: 'Custom',
          baseUrl: 'https://example.invalid/v1/',
          api: 'openai-completions',
          apiKey: '$TEST_API_KEY',
          models: [{ id: 'model-a', name: 'Model A', contextWindow: 8192, maxTokens: 2048 }],
        },
      },
    })
    expect(readFileSync(join(agentDir, 'models.json'), 'utf8')).not.toContain('sk-test')
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

  it('does not write invalid config', async () => {
    const agentDir = createAgentDir()
    const sdk = {
      ModelRuntime: {
        create: vi.fn(async () => ({ getError: () => 'invalid provider config' })),
      },
    }

    await expect(
      writeModelsConfigWithSdk({ providers: { broken: { models: [{ id: 'bad' }] } } }, sdk, agentDir),
    ).resolves.toEqual({
      ok: false,
      error: 'invalid provider config',
      path: join(agentDir, 'models.json'),
    })
    expect(() => readFileSync(join(agentDir, 'models.json'), 'utf8')).toThrow()
  })
})
