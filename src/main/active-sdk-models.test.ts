import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { basename, join } from 'path'
import { describe, expect, it, vi } from 'vitest'
import {
  listAvailableModelsWithSdk,
  listCatalogModelsWithSdk,
  resolveAvailableModels,
  resolveCatalogModels,
  UNSUPPORTED_MODEL_SDK_ERROR,
  validateModelsConfigWithSdk,
  validateModelsPathWithSdk,
} from './active-sdk-models'

describe('active SDK model compatibility', () => {
  it('should_validate_models_with_the_modern_model_runtime', async () => {
    const getError = vi.fn(() => 'modern schema error')
    const create = vi.fn(async () => ({ getError }))

    await expect(
      validateModelsPathWithSdk({ ModelRuntime: { create } }, 'C:/tmp/models.json'),
    ).resolves.toBe('modern schema error')
    expect(create).toHaveBeenCalledWith({
      modelsPath: 'C:/tmp/models.json',
      allowModelNetwork: false,
    })
    expect(getError).toHaveBeenCalledOnce()
  })

  it('should_validate_models_with_the_legacy_registry', async () => {
    const auth = {}
    const getModelsJsonError = vi.fn(() => 'legacy schema error')
    const authCreate = vi.fn(() => auth)
    const registryCreate = vi.fn(() => ({ getModelsJsonError }))

    await expect(
      validateModelsPathWithSdk(
        {
          AuthStorage: { create: authCreate },
          ModelRegistry: { create: registryCreate },
        },
        'C:/tmp/models.json',
      ),
    ).resolves.toBe('legacy schema error')
    expect(registryCreate).toHaveBeenCalledWith(auth, 'C:/tmp/models.json')
  })

  it('should_validate_models_with_the_registry_getError_api', async () => {
    const auth = {}
    const getError = vi.fn(() => 'registry schema error')
    const authCreate = vi.fn(() => auth)
    const registryCreate = vi.fn(() => ({ getError }))

    await expect(
      validateModelsPathWithSdk(
        {
          AuthStorage: { create: authCreate },
          ModelRegistry: { create: registryCreate },
        },
        'C:/tmp/models.json',
      ),
    ).resolves.toBe('registry schema error')
    expect(registryCreate).toHaveBeenCalledWith(auth, 'C:/tmp/models.json')
    expect(getError).toHaveBeenCalledOnce()
  })

  it('should_return_a_stable_error_for_an_unsupported_sdk', async () => {
    await expect(validateModelsPathWithSdk({}, 'C:/tmp/models.json')).resolves.toBe(
      UNSUPPORTED_MODEL_SDK_ERROR,
    )
  })

  it('should_reject_a_modern_runtime_without_the_validation_api', async () => {
    await expect(
      validateModelsPathWithSdk(
        { ModelRuntime: { create: vi.fn(async () => ({})) } },
        'C:/tmp/models.json',
      ),
    ).resolves.toBe(UNSUPPORTED_MODEL_SDK_ERROR)
  })

  it('should_reject_a_legacy_registry_without_the_validation_api', async () => {
    await expect(
      validateModelsPathWithSdk(
        {
          AuthStorage: { create: vi.fn(() => ({})) },
          ModelRegistry: { create: vi.fn(() => ({})) },
        },
        'C:/tmp/models.json',
      ),
    ).resolves.toBe(UNSUPPORTED_MODEL_SDK_ERROR)
  })

  it('should_remove_the_temporary_models_file_after_validation', async () => {
    const agentDir = mkdtempSync(join(tmpdir(), 'pi-model-validation-'))
    let modelsPath = ''
    const create = vi.fn(async (options?: { modelsPath?: string | null }) => {
      modelsPath = options?.modelsPath || ''
      expect(existsSync(modelsPath)).toBe(true)
      expect(basename(modelsPath)).toMatch(/^\.models-json-validate-/)
      return { getError: () => undefined }
    })

    await expect(
      validateModelsConfigWithSdk(
        { ModelRuntime: { create } },
        agentDir,
        { providers: {} },
      ),
    ).resolves.toBeUndefined()
    expect(existsSync(modelsPath)).toBe(false)
  })

  it('should_remove_the_temporary_models_file_when_validation_throws', async () => {
    const agentDir = mkdtempSync(join(tmpdir(), 'pi-model-validation-error-'))
    let modelsPath = ''
    const create = vi.fn(async (options?: { modelsPath?: string | null }) => {
      modelsPath = options?.modelsPath || ''
      throw new Error('validation failed')
    })

    await expect(
      validateModelsConfigWithSdk(
        { ModelRuntime: { create } },
        agentDir,
        { providers: {} },
      ),
    ).rejects.toThrow('validation failed')
    expect(existsSync(modelsPath)).toBe(false)
  })

  it('should_list_the_complete_catalog_with_the_modern_model_runtime_without_network', async () => {
    const models = [
      { id: 'built-in', provider: 'anthropic' },
      { id: 'store-only', provider: 'custom' },
    ]
    const getModels = vi.fn(() => models)
    const create = vi.fn(async () => ({ getModels }))

    await expect(listCatalogModelsWithSdk({ ModelRuntime: { create } })).resolves.toEqual(models)
    expect(create).toHaveBeenCalledWith({ allowModelNetwork: false })
    expect(getModels).toHaveBeenCalledOnce()
  })

  it('should_use_the_legacy_catalog_when_a_hybrid_modern_runtime_lacks_getModels', async () => {
    const models = [{ id: 'legacy-catalog', provider: 'custom' }]
    const runtimeCreate = vi.fn(async () => ({ getAvailableSnapshot: () => [] }))
    const auth = {}
    const authCreate = vi.fn(() => auth)
    const getAll = vi.fn(() => models)
    const registryCreate = vi.fn(() => ({ getAll }))

    await expect(
      listCatalogModelsWithSdk({
        ModelRuntime: { create: runtimeCreate },
        AuthStorage: { create: authCreate },
        ModelRegistry: { create: registryCreate },
      }),
    ).resolves.toEqual(models)
    expect(runtimeCreate).toHaveBeenCalledWith({ allowModelNetwork: false })
    expect(registryCreate).toHaveBeenCalledWith(auth)
    expect(getAll).toHaveBeenCalledOnce()
  })

  it('should_list_store_models_when_models_json_is_absent', async () => {
    const agentDir = mkdtempSync(join(tmpdir(), 'pi-model-store-only-'))
    const modelsPath = join(agentDir, 'models.json')
    const storePath = join(agentDir, 'models-store.json')
    const storeConfig = { models: [{ id: 'store-only', provider: 'custom' }] }
    writeFileSync(storePath, JSON.stringify(storeConfig), 'utf8')
    const create = vi.fn(async (options?: { modelsPath?: string | null; allowModelNetwork?: boolean }) => {
      expect(options?.modelsPath).toBe(modelsPath)
      expect(existsSync(modelsPath)).toBe(false)
      const store = JSON.parse(readFileSync(storePath, 'utf8')) as typeof storeConfig
      return { getModels: () => store.models }
    })

    await expect(
      listCatalogModelsWithSdk({
        getAgentDir: () => agentDir,
        ModelRuntime: { create },
      }),
    ).resolves.toEqual([{ id: 'store-only', provider: 'custom' }])
    expect(create).toHaveBeenCalledWith({ modelsPath, allowModelNetwork: false })
    expect(existsSync(modelsPath)).toBe(false)
  })

  it('should_let_the_modern_sdk_merge_an_override_only_models_file_with_its_store', async () => {
    const agentDir = mkdtempSync(join(tmpdir(), 'pi-model-catalog-'))
    const modelsPath = join(agentDir, 'models.json')
    const storePath = join(agentDir, 'models-store.json')
    const overrideConfig = { models: [{ id: 'override-only', provider: 'custom' }] }
    const storeConfig = { models: [{ id: 'store-only', provider: 'custom' }] }
    writeFileSync(modelsPath, JSON.stringify(overrideConfig), 'utf8')
    writeFileSync(storePath, JSON.stringify(storeConfig), 'utf8')
    const originalFiles = readdirSync(agentDir)
    const create = vi.fn(async (options?: { modelsPath?: string | null; allowModelNetwork?: boolean }) => {
      const activeModelsPath = options?.modelsPath || ''
      const overrides = JSON.parse(readFileSync(activeModelsPath, 'utf8')) as typeof overrideConfig
      const store = JSON.parse(
        readFileSync(join(activeModelsPath, '..', 'models-store.json'), 'utf8'),
      ) as typeof storeConfig
      return { getModels: () => [...store.models, ...overrides.models] }
    })

    await expect(
      listCatalogModelsWithSdk({
        getAgentDir: () => agentDir,
        ModelRuntime: { create },
      }),
    ).resolves.toEqual([
      { id: 'store-only', provider: 'custom' },
      { id: 'override-only', provider: 'custom' },
    ])
    expect(create).toHaveBeenCalledWith({ modelsPath, allowModelNetwork: false })
    expect(readdirSync(agentDir)).toEqual(originalFiles)
    expect(readFileSync(modelsPath, 'utf8')).toBe(JSON.stringify(overrideConfig))
    expect(readFileSync(storePath, 'utf8')).toBe(JSON.stringify(storeConfig))
  })

  it('should_list_the_complete_catalog_with_the_legacy_registry', async () => {
    const models = [
      { id: 'built-in', provider: 'anthropic' },
      { id: 'override', provider: 'custom' },
    ]
    const auth = {}
    const authCreate = vi.fn(() => auth)
    const getAll = vi.fn(() => models)
    const registryCreate = vi.fn(() => ({ getAll }))

    await expect(
      listCatalogModelsWithSdk({
        AuthStorage: { create: authCreate },
        ModelRegistry: { create: registryCreate },
      }),
    ).resolves.toEqual(models)
    expect(registryCreate).toHaveBeenCalledWith(auth)
    expect(getAll).toHaveBeenCalledOnce()
  })

  it('should_prefer_the_sdk_catalog_when_models_json_contains_only_overrides', async () => {
    const sdk = vi.fn(async () => [
      { id: 'built-in', provider: 'anthropic' },
      { id: 'store-only', provider: 'custom' },
    ])
    const modelsJson = vi.fn(() => [{ id: 'override-only', provider: 'custom' }])

    await expect(resolveCatalogModels({ sdk, catalog: modelsJson })).resolves.toEqual([
      { id: 'built-in', provider: 'anthropic' },
      { id: 'store-only', provider: 'custom' },
    ])
    expect(modelsJson).not.toHaveBeenCalled()
  })

  it('should_fall_back_to_models_json_when_the_sdk_catalog_is_unsupported', async () => {
    const modelsJson = vi.fn(() => [{ id: 'override-only', provider: 'custom' }])

    await expect(
      resolveCatalogModels({ sdk: vi.fn(async () => []), catalog: modelsJson }),
    ).resolves.toEqual([{ id: 'override-only', provider: 'custom' }])
    expect(modelsJson).toHaveBeenCalledOnce()
  })

  it('should_list_available_models_with_the_modern_model_runtime', async () => {
    const models = [{ id: 'modern', provider: 'test' }]
    const create = vi.fn(async () => ({ getAvailable: vi.fn(async () => models) }))

    await expect(listAvailableModelsWithSdk({ ModelRuntime: { create } })).resolves.toEqual(models)
    expect(create).toHaveBeenCalledWith({ allowModelNetwork: true })
  })

  it('should_list_available_models_from_a_modern_snapshot', async () => {
    const models = [{ id: 'snapshot', provider: 'test' }]
    const create = vi.fn(async () => ({ getAvailableSnapshot: vi.fn(() => models) }))

    await expect(listAvailableModelsWithSdk({ ModelRuntime: { create } })).resolves.toEqual(models)
  })

  it('should_list_available_models_with_the_legacy_registry', async () => {
    const models = [{ id: 'legacy', provider: 'test' }]
    const auth = {}
    const authCreate = vi.fn(() => auth)
    const getAvailable = vi.fn(async () => models)
    const registryCreate = vi.fn(() => ({ getAvailable }))

    await expect(
      listAvailableModelsWithSdk({
        AuthStorage: { create: authCreate },
        ModelRegistry: { create: registryCreate },
      }),
    ).resolves.toEqual(models)
    expect(registryCreate).toHaveBeenCalledWith(auth)
  })

  it('should_return_no_available_models_for_an_unsupported_sdk', async () => {
    await expect(listAvailableModelsWithSdk({})).resolves.toEqual([])
  })

  it('should_prefer_worker_models_without_calling_sdk_or_catalog', async () => {
    const worker = vi.fn(async () => [{ id: 'worker' }])
    const sdk = vi.fn(async () => [{ id: 'sdk' }])
    const catalog = vi.fn(() => [{ id: 'catalog' }])

    await expect(resolveAvailableModels({ worker, sdk })).resolves.toEqual([{ id: 'worker' }])
    expect(sdk).not.toHaveBeenCalled()
    expect(catalog).not.toHaveBeenCalled()
  })

  it('should_fall_back_from_an_empty_worker_to_sdk_models', async () => {
    const worker = vi.fn(async () => [])
    const sdk = vi.fn(async () => [{ id: 'sdk' }])
    const catalog = vi.fn(() => [{ id: 'catalog' }])

    await expect(resolveAvailableModels({ worker, sdk })).resolves.toEqual([{ id: 'sdk' }])
    expect(catalog).not.toHaveBeenCalled()
  })

  it('should_return_empty_without_reading_catalog_when_worker_and_sdk_fail', async () => {
    const onWorkerError = vi.fn()
    const onSdkError = vi.fn()
    const catalog = vi.fn(() => [{ id: 'catalog' }])
    const workerError = new Error('worker failed')
    const sdkError = new Error('sdk failed')

    const input = {
      worker: vi.fn(async () => {
        throw workerError
      }),
      sdk: vi.fn(async () => {
        throw sdkError
      }),
      catalog,
      onWorkerError,
      onSdkError,
    }

    await expect(resolveAvailableModels(input)).resolves.toEqual([])
    expect(catalog).not.toHaveBeenCalled()
    expect(onWorkerError).toHaveBeenCalledWith(workerError)
    expect(onSdkError).toHaveBeenCalledWith(sdkError)
  })

  it('should_return_empty_without_reading_catalog_when_worker_and_sdk_are_empty', async () => {
    const catalog = vi.fn(() => [{ id: 'catalog' }])

    const input = {
      worker: vi.fn(async () => []),
      sdk: vi.fn(async () => []),
      catalog,
    }

    await expect(resolveAvailableModels(input)).resolves.toEqual([])
    expect(catalog).not.toHaveBeenCalled()
  })
})
