export const MODEL_AUTH_SOURCES = [
  'stored',
  'runtime',
  'environment',
  'fallback',
  'models_json_key',
  'models_json_command',
] as const

export type ModelAuthSource = (typeof MODEL_AUTH_SOURCES)[number] | 'unknown'
export type ModelAuthType = 'api_key' | 'oauth'

export type ModelAuthProjection = {
  supported: boolean
  configured?: boolean
  source?: ModelAuthSource
  type?: ModelAuthType
}

export type AvailableModelProjectionInput = {
  id: string
  name?: string
  provider?: string
  contextWindow?: number
  maxOutput?: number
  maxTokens?: number
}

export type ModelAuthProjectionRuntime = {
  getProviderAuthStatus?: (providerId: string) => {
    configured: boolean
    source?: string
  }
  listCredentials?: () => Promise<
    readonly { providerId: string; type: string }[]
  >
}

export type ProjectedCatalogModel = AvailableModelProjectionInput & {
  available: boolean
  managedBy: 'active-sdk'
  auth: ModelAuthProjection
}

function normalizeSource(value: unknown): ModelAuthSource | undefined {
  if (typeof value !== 'string' || !value) return undefined
  return (MODEL_AUTH_SOURCES as readonly string[]).includes(value)
    ? (value as ModelAuthSource)
    : 'unknown'
}

function normalizeType(value: unknown): ModelAuthType | undefined {
  return value === 'api_key' || value === 'oauth' ? value : undefined
}

export async function projectModelCatalog(
  runtime: ModelAuthProjectionRuntime,
  models: readonly AvailableModelProjectionInput[],
): Promise<ProjectedCatalogModel[]> {
  const credentialTypes = new Map<string, ModelAuthType>()
  if (runtime.listCredentials) {
    try {
      for (const credential of await runtime.listCredentials()) {
        const type = normalizeType(credential.type)
        if (type) credentialTypes.set(credential.providerId, type)
      }
    } catch {
      // Optional status metadata must not hide catalog models.
    }
  }

  return models.map((model) => {
    const provider = model.provider || ''
    let auth: ModelAuthProjection = { supported: false }
    if (provider && runtime.getProviderAuthStatus) {
      try {
        const status = runtime.getProviderAuthStatus(provider)
        auth = {
          supported: true,
          configured: status.configured,
          source: normalizeSource(status.source),
          type: credentialTypes.get(provider),
        }
      } catch {
        // Older or partial SDKs can still provide a valid catalog.
      }
    }

    return {
      id: model.id,
      name: model.name,
      provider: model.provider,
      contextWindow: model.contextWindow,
      maxOutput: model.maxOutput,
      maxTokens: model.maxTokens,
      available: auth.configured === true,
      managedBy: 'active-sdk',
      auth,
    }
  })
}
