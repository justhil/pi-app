import { describe, expect, it, vi } from 'vitest'
import { projectModelCatalog } from './model-auth-projection'

describe('projectModelCatalog', () => {
  it('projects only typed non-secret auth metadata', async () => {
    const getAuth = vi.fn(() => ({ apiKey: 'sk-secret' }))
    const result = await projectModelCatalog(
      {
        getProviderAuthStatus: () => ({
          configured: true,
          source: 'stored',
          label: 'sk-label-secret',
        }),
        listCredentials: async () => [
          { providerId: 'openai', type: 'oauth', secret: 'credential-secret' },
        ],
        getAuth,
      } as never,
      [{ id: 'gpt', provider: 'openai' }],
    )

    expect(result[0]).toMatchObject({
      available: true,
      managedBy: 'active-sdk',
      auth: {
        supported: true,
        configured: true,
        source: 'stored',
        type: 'oauth',
      },
    })
    expect(result[0]?.auth).not.toHaveProperty('label')
    expect(getAuth).not.toHaveBeenCalled()
    expect(JSON.stringify(result)).not.toMatch(
      /sk-secret|sk-label-secret|credential-secret/,
    )
  })

  it('projects catalog models with configured false instead of filtering them out', async () => {
    await expect(
      projectModelCatalog(
        {
          getProviderAuthStatus: () => ({ configured: false }),
        },
        [{ id: 'unconfigured', provider: 'anthropic' }],
      ),
    ).resolves.toEqual([
      expect.objectContaining({
        id: 'unconfigured',
        available: false,
        managedBy: 'active-sdk',
        auth: {
          supported: true,
          configured: false,
          source: undefined,
          type: undefined,
        },
      }),
    ])
  })

  it('keeps catalog models visible when auth capabilities are absent', async () => {
    await expect(
      projectModelCatalog({}, [{ id: 'legacy', provider: 'legacy' }]),
    ).resolves.toEqual([
      expect.objectContaining({
        id: 'legacy',
        available: false,
        managedBy: 'active-sdk',
        auth: { supported: false },
      }),
    ])
  })

  it('maps unknown sources honestly and ignores unsupported credential types', async () => {
    const [model] = await projectModelCatalog(
      {
        getProviderAuthStatus: () => ({ configured: false, source: 'future' }),
        listCredentials: async () => [{ providerId: 'future', type: 'future' }],
      },
      [{ id: 'future', provider: 'future' }],
    )

    expect(model.auth).toEqual({
      supported: true,
      configured: false,
      source: 'unknown',
      type: undefined,
    })
    expect(model.available).toBe(false)
  })

  it('keeps catalog models visible when optional auth status calls fail', async () => {
    const models = [{ id: 'catalog', provider: 'custom' }]

    await expect(
      projectModelCatalog(
        {
          getProviderAuthStatus: () => {
            throw new Error('status failed')
          },
          listCredentials: async () => {
            throw new Error('credentials failed')
          },
        },
        models,
      ),
    ).resolves.toEqual([
      expect.objectContaining({
        id: 'catalog',
        available: false,
        managedBy: 'active-sdk',
        auth: { supported: false },
      }),
    ])
  })
})
