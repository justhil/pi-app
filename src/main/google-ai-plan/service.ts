import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app, BrowserWindow, net, shell } from 'electron'
import { resolveActiveAgentDir } from '../agent-dir'
import { resolveActiveSdkRoot } from '../sdk-loader'
import { workerManager } from '../worker-manager'
import { isWslRuntimeActive } from '../wsl/runtime-config'
import { sendEvent } from '../ipc/registry'
import { invalidateExtensionProbeCache } from '../extension-probe-cache'
import type { ModelEntry } from '../active-sdk-models-core'
import {
  GOOGLE_AI_PLAN_PROVIDER_ID,
  UPSTREAM_PR_NUMBER,
  UPSTREAM_PR_URL,
  extractClientCredentialsFromSource,
  fetchAndInstallGoogleAiPlanExtension,
  readInstalledGoogleAiPlanExtension,
  removeGoogleAiPlanExtensionDir,
  type GoogleAiPlanClientConfig,
  type GoogleAiPlanModelDef,
} from './sync-upstream-pr'
import {
  GoogleAiPlanOAuthSession,
  type GoogleAiPlanLoginSnapshot,
  type GoogleAiPlanOAuthCredential,
} from './oauth-flow'

export interface GoogleAiPlanStatus {
  prNumber: number
  prUrl: string
  wslUnsupported: boolean
  builtinInSdk: boolean
  autoRemovedForBuiltinSdk: boolean
  installed: boolean
  managedByApp: boolean
  extensionDir: string
  installedSha: string | null
  fetchedAt: number | null
  signedIn: boolean
  expiresAt: number | null
  models: Array<{ id: string; name: string }>
  login: GoogleAiPlanLoginSnapshot
}

const oauthSession = new GoogleAiPlanOAuthSession()
let autoRemovedForBuiltinSdk = false

const proxyAwareFetch: typeof fetch = (input, init) => {
  if (typeof net?.fetch === 'function') {
    return net.fetch(String(input), init as Parameters<typeof net.fetch>[1])
  }
  return globalThis.fetch(input, init)
}

function notifyRuntimeChanged(): void {
  for (const win of BrowserWindow.getAllWindows()) {
    sendEvent(win, { type: 'sdk-runtime-changed' })
  }
}

export function detectSdkBuiltinGoogleAiPlan(
  userDataDir = app.getPath('userData'),
  sdkRootOverride?: string | null,
): boolean {
  try {
    const sdkRoot = sdkRootOverride !== undefined ? sdkRootOverride : resolveActiveSdkRoot(userDataDir)
    if (!sdkRoot) return false
    const providerCandidates = [
      join(sdkRoot, 'node_modules', '@earendil-works', 'pi-ai', 'dist', 'providers', 'google-ai-plan.js'),
      join(sdkRoot, 'node_modules', '@earendil-works', 'pi-ai', 'dist', 'providers', 'data', 'google-ai-plan.json'),
      join(sdkRoot, '..', 'pi-ai', 'dist', 'providers', 'google-ai-plan.js'),
      join(sdkRoot, '..', 'pi-ai', 'dist', 'providers', 'data', 'google-ai-plan.json'),
    ]
    if (providerCandidates.some((p) => existsSync(p))) return true

    const clientIdentityPath = join(sdkRoot, 'dist', 'core', 'client-identity.js')
    if (existsSync(clientIdentityPath)) {
      const src = readFileSync(clientIdentityPath, 'utf8')
      if (src.includes('PI_GOOGLE_AI_PLAN_CLIENT')) return true
    }
    return false
  } catch {
    return false
  }
}

export function readBuiltinSdkClientCredentials(
  userDataDir = app.getPath('userData'),
  sdkRootOverride?: string | null,
): GoogleAiPlanClientConfig | null {
  try {
    const sdkRoot = sdkRootOverride !== undefined ? sdkRootOverride : resolveActiveSdkRoot(userDataDir)
    if (!sdkRoot) return null
    const clientIdentityPath = join(sdkRoot, 'dist', 'core', 'client-identity.js')
    if (!existsSync(clientIdentityPath)) return null
    return extractClientCredentialsFromSource(readFileSync(clientIdentityPath, 'utf8'))
  } catch {
    return null
  }
}

export function isGoogleAiPlanPreviewExtension(agentDir: string): boolean {
  const ext = readInstalledGoogleAiPlanExtension(agentDir)
  if (!ext.installed) return false
  if (ext.managedByApp) return true
  try {
    const src = readFileSync(ext.entryPath, 'utf8')
    return (
      src.includes(GOOGLE_AI_PLAN_PROVIDER_ID) &&
      (src.includes('google-interactions') || src.includes('PI_GOOGLE_AI_PLAN_CLIENT'))
    )
  } catch {
    return false
  }
}

/**
 * Automatically remove the local `extensions/google-ai-plan` preview shim once the active Pi SDK
 * ships `google-ai-plan` natively, keeping `auth.json` untouched so existing sign-in persists.
 */
export function cleanupObsoleteGoogleAiPlanExtension(options?: {
  agentDir?: string
  userDataDir?: string
  sdkRootOverride?: string | null
}): { removed: boolean; builtinInSdk: boolean } {
  if (isWslRuntimeActive()) return { removed: false, builtinInSdk: false }
  const builtinInSdk = detectSdkBuiltinGoogleAiPlan(
    options?.userDataDir ?? app.getPath('userData'),
    options?.sdkRootOverride,
  )
  if (!builtinInSdk) return { removed: false, builtinInSdk: false }
  const agentDir = options?.agentDir ?? resolveActiveAgentDir()
  if (!isGoogleAiPlanPreviewExtension(agentDir)) {
    return { removed: false, builtinInSdk: true }
  }
  const removed = removeGoogleAiPlanExtensionDir(agentDir)
  if (removed) {
    autoRemovedForBuiltinSdk = true
    invalidateExtensionProbeCache()
  }
  return { removed, builtinInSdk: true }
}

export function readGoogleAiPlanAuth(agentDir: string): {
  signedIn: boolean
  expiresAt: number | null
} {
  const authPath = join(agentDir, 'auth.json')
  if (!existsSync(authPath)) return { signedIn: false, expiresAt: null }
  try {
    const raw = JSON.parse(readFileSync(authPath, 'utf8')) as Record<string, unknown>
    const entry = raw?.[GOOGLE_AI_PLAN_PROVIDER_ID] as Record<string, unknown> | undefined
    if (
      entry &&
      entry.type === 'oauth' &&
      typeof entry.access === 'string' &&
      entry.access.length > 0 &&
      typeof entry.refresh === 'string' &&
      entry.refresh.length > 0 &&
      entry.dpopKey &&
      typeof entry.dpopKey === 'object'
    ) {
      return {
        signedIn: true,
        expiresAt: typeof entry.expires === 'number' ? entry.expires : null,
      }
    }
  } catch {
    /* ignore malformed auth.json */
  }
  return { signedIn: false, expiresAt: null }
}

export function writeGoogleAiPlanAuth(
  agentDir: string,
  credential: GoogleAiPlanOAuthCredential,
): void {
  mkdirSync(agentDir, { recursive: true, mode: 0o700 })
  const authPath = join(agentDir, 'auth.json')
  let current: Record<string, unknown> = {}
  if (existsSync(authPath)) {
    try {
      const parsed = JSON.parse(readFileSync(authPath, 'utf8'))
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        current = parsed as Record<string, unknown>
      }
    } catch {
      current = {}
    }
  }
  current[GOOGLE_AI_PLAN_PROVIDER_ID] = credential
  const tmpPath = `${authPath}.${process.pid}.${Date.now()}.tmp`
  writeFileSync(tmpPath, `${JSON.stringify(current, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
  renameSync(tmpPath, authPath)
}

export function deleteGoogleAiPlanAuth(agentDir: string): boolean {
  const authPath = join(agentDir, 'auth.json')
  if (!existsSync(authPath)) return false
  let current: Record<string, unknown> = {}
  try {
    const parsed = JSON.parse(readFileSync(authPath, 'utf8'))
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return false
    current = parsed as Record<string, unknown>
  } catch {
    return false
  }
  if (!(GOOGLE_AI_PLAN_PROVIDER_ID in current)) return false
  delete current[GOOGLE_AI_PLAN_PROVIDER_ID]
  const tmpPath = `${authPath}.${process.pid}.${Date.now()}.tmp`
  writeFileSync(tmpPath, `${JSON.stringify(current, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
  renameSync(tmpPath, authPath)
  return true
}

async function refreshLiveWorkers(reloadExtensions: boolean): Promise<void> {
  if (!workerManager.isRunning) return
  if (reloadExtensions) {
    await workerManager.reloadResources().catch(() => {})
  }
  await workerManager.reloadModels().catch(() => {})
}

export function getGoogleAiPlanStatus(): GoogleAiPlanStatus {
  const wslUnsupported = isWslRuntimeActive()
  const agentDir = resolveActiveAgentDir()
  const cleanup = wslUnsupported ? { removed: false, builtinInSdk: false } : cleanupObsoleteGoogleAiPlanExtension({ agentDir })
  if (cleanup.removed) {
    void refreshLiveWorkers(true).then(() => notifyRuntimeChanged())
  }
  const ext = readInstalledGoogleAiPlanExtension(agentDir)
  const auth = readGoogleAiPlanAuth(agentDir)

  return {
    prNumber: UPSTREAM_PR_NUMBER,
    prUrl: UPSTREAM_PR_URL,
    wslUnsupported,
    builtinInSdk: cleanup.builtinInSdk,
    autoRemovedForBuiltinSdk,
    installed: ext.installed,
    managedByApp: ext.managedByApp,
    extensionDir: ext.dir,
    installedSha: ext.meta?.sha ?? null,
    fetchedAt: ext.meta?.fetchedAt ?? null,
    signedIn: auth.signedIn,
    expiresAt: auth.expiresAt,
    models: ext.models.map((m) => ({ id: m.id, name: m.name })),
    login: oauthSession.getSnapshot(),
  }
}

export async function syncGoogleAiPlanExtension(): Promise<{
  ok: boolean
  status: GoogleAiPlanStatus
  error?: string
}> {
  if (isWslRuntimeActive()) {
    return { ok: false, status: getGoogleAiPlanStatus(), error: 'WSL_UNSUPPORTED' }
  }
  const cleanup = cleanupObsoleteGoogleAiPlanExtension()
  if (cleanup.builtinInSdk) {
    if (cleanup.removed) {
      await refreshLiveWorkers(true)
      notifyRuntimeChanged()
    }
    return { ok: true, status: getGoogleAiPlanStatus() }
  }
  const agentDir = resolveActiveAgentDir()
  try {
    await fetchAndInstallGoogleAiPlanExtension(agentDir, { fetchImpl: proxyAwareFetch })
    invalidateExtensionProbeCache()
    await refreshLiveWorkers(true)
    notifyRuntimeChanged()
    return { ok: true, status: getGoogleAiPlanStatus() }
  } catch (err) {
    return {
      ok: false,
      status: getGoogleAiPlanStatus(),
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

export async function removeGoogleAiPlanExtension(): Promise<{
  ok: boolean
  status: GoogleAiPlanStatus
  error?: string
}> {
  if (isWslRuntimeActive()) {
    return { ok: false, status: getGoogleAiPlanStatus(), error: 'WSL_UNSUPPORTED' }
  }
  oauthSession.cancel()
  const agentDir = resolveActiveAgentDir()
  try {
    removeGoogleAiPlanExtensionDir(agentDir)
    invalidateExtensionProbeCache()
    await refreshLiveWorkers(true)
    notifyRuntimeChanged()
    return { ok: true, status: getGoogleAiPlanStatus() }
  } catch (err) {
    return {
      ok: false,
      status: getGoogleAiPlanStatus(),
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

export async function startGoogleAiPlanLogin(opts?: {
  autoSync?: boolean
}): Promise<{ ok: boolean; status: GoogleAiPlanStatus; error?: string }> {
  if (isWslRuntimeActive()) {
    return { ok: false, status: getGoogleAiPlanStatus(), error: 'WSL_UNSUPPORTED' }
  }
  const agentDir = resolveActiveAgentDir()
  const cleanup = cleanupObsoleteGoogleAiPlanExtension({ agentDir })
  if (cleanup.removed) {
    await refreshLiveWorkers(true)
  }

  let client: GoogleAiPlanClientConfig | null = cleanup.builtinInSdk
    ? readBuiltinSdkClientCredentials()
    : null

  if (!cleanup.builtinInSdk) {
    let ext = readInstalledGoogleAiPlanExtension(agentDir)
    if ((!ext.installed || !ext.client) && opts?.autoSync !== false) {
      try {
        await fetchAndInstallGoogleAiPlanExtension(agentDir, { fetchImpl: proxyAwareFetch })
        invalidateExtensionProbeCache()
        await refreshLiveWorkers(true)
        ext = readInstalledGoogleAiPlanExtension(agentDir)
      } catch (err) {
        return {
          ok: false,
          status: getGoogleAiPlanStatus(),
          error: err instanceof Error ? err.message : String(err),
        }
      }
    }
    client = ext.client
  }

  if (!client) {
    return {
      ok: false,
      status: getGoogleAiPlanStatus(),
      error: 'Google AI Ultra extension is not installed or missing OAuth client config.',
    }
  }

  try {
    const snap = await oauthSession.start({
      client,
      fetchImpl: proxyAwareFetch,
      onSuccess: async (credential) => {
        writeGoogleAiPlanAuth(agentDir, credential)
        await refreshLiveWorkers(false)
      },
      onChange: () => {
        notifyRuntimeChanged()
      },
    })
    if (snap.authUrl) {
      await shell.openExternal(snap.authUrl)
    }
    return { ok: true, status: getGoogleAiPlanStatus() }
  } catch (err) {
    return {
      ok: false,
      status: getGoogleAiPlanStatus(),
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

export async function submitGoogleAiPlanCallbackUrl(
  callbackUrl: string,
): Promise<{ ok: boolean; status: GoogleAiPlanStatus; error?: string }> {
  try {
    await oauthSession.submitManualUrl(callbackUrl)
    return { ok: true, status: getGoogleAiPlanStatus() }
  } catch (err) {
    return {
      ok: false,
      status: getGoogleAiPlanStatus(),
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

export function cancelGoogleAiPlanLogin(): { ok: boolean; status: GoogleAiPlanStatus } {
  oauthSession.cancel()
  return { ok: true, status: getGoogleAiPlanStatus() }
}

export async function logoutGoogleAiPlan(): Promise<{
  ok: boolean
  status: GoogleAiPlanStatus
  error?: string
}> {
  if (isWslRuntimeActive()) {
    return { ok: false, status: getGoogleAiPlanStatus(), error: 'WSL_UNSUPPORTED' }
  }
  oauthSession.cancel()
  const agentDir = resolveActiveAgentDir()
  try {
    deleteGoogleAiPlanAuth(agentDir)
    await refreshLiveWorkers(false)
    notifyRuntimeChanged()
    return { ok: true, status: getGoogleAiPlanStatus() }
  } catch (err) {
    return {
      ok: false,
      status: getGoogleAiPlanStatus(),
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

function toProjectedModelEntry(
  model: GoogleAiPlanModelDef,
  signedIn: boolean,
): ModelEntry {
  return {
    id: model.id,
    name: model.name,
    provider: GOOGLE_AI_PLAN_PROVIDER_ID,
    contextWindow: model.contextWindow ?? 1048576,
    maxOutput: model.maxTokens ?? 65536,
    maxTokens: model.maxTokens ?? 65536,
    available: signedIn,
    managedBy: 'active-sdk',
    auth: {
      supported: true,
      configured: signedIn,
      type: signedIn ? 'oauth' : undefined,
      source: signedIn ? 'stored' : undefined,
    },
  }
}

/**
 * Cold-start projection: when no worker has loaded user extensions yet, include the locally
 * installed `google-ai-plan` extension models and auth status in `model.list` responses.
 */
export function augmentModelsWithGoogleAiPlan<T extends ModelEntry>(
  models: readonly T[],
  scope: 'available' | 'catalog' | 'settings',
  agentDir = resolveActiveAgentDir(),
): T[] {
  if (isWslRuntimeActive()) return [...models]
  if (models.some((m) => m.provider === GOOGLE_AI_PLAN_PROVIDER_ID)) return [...models]
  const ext = readInstalledGoogleAiPlanExtension(agentDir)
  if (!ext.installed || ext.models.length === 0) return [...models]
  const { signedIn } = readGoogleAiPlanAuth(agentDir)
  if (scope === 'available' && !signedIn) return [...models]
  return [
    ...models,
    ...ext.models.map((m) => toProjectedModelEntry(m, signedIn) as unknown as T),
  ]
}
