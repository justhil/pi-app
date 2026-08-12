type PreviewSettings = Record<string, unknown> & {
  packages?: unknown[]
  extensions?: string[]
}
type PreviewSettingsManager = object
type PreviewSettingsStorage = {
  withLock: (
    scope: 'global' | 'project',
    fn: (current: string | undefined) => string | undefined,
  ) => void
}
type PreviewResourceLoader = object
type PreviewModelRuntime = object
type PreviewSession = {
  systemPrompt?: string
  dispose: () => void | Promise<void>
}
type EmptyCredentialStore = {
  read: (providerId: string) => Promise<undefined>
  list: () => Promise<never[]>
  modify: (providerId: string, fn: (current: undefined) => Promise<undefined>) => Promise<undefined>
  delete: (providerId: string) => Promise<void>
}
type EmptyModelsStore = {
  read: (providerId: string) => Promise<undefined>
  write: (providerId: string, entry: unknown) => Promise<void>
  delete: (providerId: string) => Promise<void>
}

type PreviewSdk = {
  getAgentDir: () => string
  SettingsManager: {
    fromStorage: (
      storage: PreviewSettingsStorage,
      options: { projectTrusted: boolean },
    ) => PreviewSettingsManager
  }
  DefaultResourceLoader: new (options: {
    cwd: string
    agentDir: string
    settingsManager: PreviewSettingsManager
    noExtensions: boolean
    noPromptTemplates: boolean
    noThemes: boolean
  }) => PreviewResourceLoader & { reload: () => Promise<void> }
  SessionManager: {
    inMemory: (cwd: string) => object
  }
  ModelRuntime: {
    create: (options: {
      credentials: EmptyCredentialStore
      modelsPath: null
      modelsStore: EmptyModelsStore
      allowModelNetwork: false
    }) => Promise<PreviewModelRuntime>
  }
  createAgentSession: (options: {
    cwd: string
    agentDir: string
    modelRuntime: PreviewModelRuntime
    settingsManager: PreviewSettingsManager
    resourceLoader: PreviewResourceLoader
    sessionManager: object
  }) => Promise<{ session: PreviewSession }>
}

function createEmptyCredentialStore(): EmptyCredentialStore {
  return {
    read: async () => undefined,
    list: async () => [],
    modify: async (_providerId, fn) => fn(undefined),
    delete: async () => {},
  }
}

function createEmptyModelsStore(): EmptyModelsStore {
  return {
    read: async () => undefined,
    write: async () => {},
    delete: async () => {},
  }
}

function stripSideEffects(settings: PreviewSettings): PreviewSettings {
  return {
    ...settings,
    packages: [],
    extensions: [],
  }
}

function createSettingsStorage(): PreviewSettingsStorage {
  const values = new Map<'global' | 'project', string>()
  return {
    withLock(scope, fn) {
      const next = fn(values.get(scope))
      if (next !== undefined) values.set(scope, next)
    },
  }
}

function seedSettingsStorage(
  storage: PreviewSettingsStorage,
  scope: 'global' | 'project',
  settings: PreviewSettings,
): void {
  storage.withLock(scope, () => JSON.stringify(stripSideEffects(settings)))
}

function assertPreviewSdk(sdk: Partial<PreviewSdk>): asserts sdk is PreviewSdk {
  if (
    typeof sdk.getAgentDir !== 'function' ||
    typeof sdk.SettingsManager?.fromStorage !== 'function' ||
    typeof sdk.DefaultResourceLoader !== 'function' ||
    typeof sdk.SessionManager?.inMemory !== 'function' ||
    typeof sdk.ModelRuntime?.create !== 'function' ||
    typeof sdk.createAgentSession !== 'function'
  ) {
    throw new Error('Active Pi SDK does not support isolated system prompt preview')
  }
}

export async function buildSystemPromptPreview(
  sdk: Partial<PreviewSdk>,
  cwd: string,
  globalSettings: PreviewSettings,
  projectSettings: PreviewSettings,
): Promise<string> {
  assertPreviewSdk(sdk)
  const agentDir = sdk.getAgentDir()
  const storage = createSettingsStorage()
  seedSettingsStorage(storage, 'global', globalSettings)
  seedSettingsStorage(storage, 'project', projectSettings)
  // Keep project prompt resources, but never install packages or execute extensions for a preview.
  const settingsManager = sdk.SettingsManager.fromStorage(storage, { projectTrusted: true })
  const resourceLoader = new sdk.DefaultResourceLoader({
    cwd,
    agentDir,
    settingsManager,
    noExtensions: true,
    noPromptTemplates: true,
    noThemes: true,
  })
  await resourceLoader.reload()

  const modelRuntime = await sdk.ModelRuntime.create({
    credentials: createEmptyCredentialStore(),
    modelsPath: null,
    modelsStore: createEmptyModelsStore(),
    allowModelNetwork: false,
  })
  const { session } = await sdk.createAgentSession({
    cwd,
    agentDir,
    modelRuntime,
    settingsManager,
    resourceLoader,
    sessionManager: sdk.SessionManager.inMemory(cwd),
  })
  try {
    return session.systemPrompt?.slice(0, 12000) || '（空）'
  } finally {
    await session.dispose()
  }
}
