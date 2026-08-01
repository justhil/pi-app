import { describe, expect, it, vi } from 'vitest'
import { saveModelsConfigDraft } from './save-models-config'

const draft = {
  providers: {
    custom: {
      baseUrl: 'https://example.invalid/v1',
      apiKey: '$TEST_API_KEY',
      models: [{ id: 'model-a' }],
    },
  },
}

describe('saveModelsConfigDraft', () => {
  it('writes then reloads the normalized baseline', async () => {
    const setConfig = vi.fn(async () => ({ ok: true }))
    const reload = vi.fn(async () => undefined)

    await saveModelsConfigDraft(draft, { setConfig, reload })

    expect(setConfig).toHaveBeenCalledWith(draft)
    expect(reload).toHaveBeenCalledOnce()
  })

  it('stops before reload when write fails', async () => {
    const setConfig = vi.fn(async () => ({ ok: false, error: 'invalid provider config' }))
    const reload = vi.fn(async () => undefined)

    await expect(saveModelsConfigDraft(draft, { setConfig, reload })).rejects.toThrow('invalid provider config')
    expect(reload).not.toHaveBeenCalled()
  })

  it('reports a reload failure after the config was written', async () => {
    const setConfig = vi.fn(async () => ({ ok: true }))
    const reload = vi.fn(async () => {
      throw new Error('reload failed')
    })

    await expect(saveModelsConfigDraft(draft, { setConfig, reload })).rejects.toThrow('reload failed')
    expect(setConfig).toHaveBeenCalledWith(draft)
  })
})
