import {
  invalidateListSessionsCache,
  listSessionsOnDisk,
} from '../main/ipc/sdk-session'
import { getSessionMessagesFromDisk } from '../main/session-messages-from-disk'
import { flattenTreeFromSessionFile } from '../main/session-tree-from-file'
import { pathToFileURL } from 'node:url'
import { applyPiSettingsPatch } from '../worker/pi-settings-patch'
import { piSettingsSnapshot } from '../worker/pi-settings-snapshot'
import { probeExtensions } from '../extension-compat/extension-probe'
import { setActiveDirResolvers } from '../extension-compat/active-dirs'
import { invalidateAdapterCatalog } from '../extension-compat/adapter-loader'
import { listAvailableModelsWithSdk, listCatalogModelsWithSdk, type ModelEntry } from '../main/active-sdk-models-core'
import { buildSessionContextPreview } from '@shared/session-context-preview'
import type { PiSessionMessage } from '@shared/worker-message'
import { buildSystemPromptPreview } from '../main/system-prompt-preview'

if (!process.parentPort) throw new Error('preview worker requires parentPort')

type PreviewRequest = {
  requestId: string
  type:
    | 'session.list'
    | 'session.getMessages'
    | 'session.tree'
    | 'session.invalidateList'
    | 'pi.settings.get'
    | 'pi.settings.set'
    | 'extensions.probe'
    | 'model.list'
    | 'context.preview'
    | 'warm'
    | 'system.prompt'
  payload: Record<string, unknown>
  userDataDir: string
  activeSdkPath?: string | null
}

process.parentPort.on('message', async (event: { data?: PreviewRequest } | PreviewRequest) => {
  const message =
    typeof event === 'object' && event !== null && 'data' in event
      ? event.data
      : event
  if (!message?.requestId) return
  try {
    let result: unknown
    if (message.type === 'session.list') {
      result = await listSessionsOnDisk(
        String(message.payload.workspaceId || ''),
        message.userDataDir,
        undefined,
        message.activeSdkPath,
      )
    } else if (message.type === 'session.invalidateList') {
      invalidateListSessionsCache(
        typeof message.payload.workspaceId === 'string' && message.payload.workspaceId
          ? message.payload.workspaceId
          : undefined,
      )
      result = null
    } else if (message.type === 'session.getMessages') {
      result = await getSessionMessagesFromDisk(
        String(message.payload.sessionFile || ''),
        Number(message.payload.offset || 0),
        message.payload.limit == null ? undefined : Number(message.payload.limit),
        message.payload.leafId as string | null | undefined,
        message.activeSdkPath,
      )
    } else if (message.type === 'session.tree') {
      result = await flattenTreeFromSessionFile(
        String(message.payload.sessionFile || ''),
        String(message.payload.cwd || ''),
        message.payload.leafId as string | null | undefined,
        message.activeSdkPath,
      )
    } else if (message.type === 'warm') {
      // Pay the cold SDK / timeline module imports before the first real request needs them.
      await (message.activeSdkPath
        ? import(pathToFileURL(message.activeSdkPath).href)
        : import('@earendil-works/pi-coding-agent'))
      await import('@shared/session-jsonl-timeline')
      result = null
    } else if (message.type === 'model.list') {
      // SDK model runtime lives here so the main (browser UI) thread never imports the SDK.
      const sdk = message.activeSdkPath
        ? await import(pathToFileURL(message.activeSdkPath).href)
        : await import('@earendil-works/pi-coding-agent')
      const agentDir = String(message.payload.agentDir || '')
      const models: readonly ModelEntry[] =
        message.payload.scope === 'available'
          ? await listAvailableModelsWithSdk(sdk, agentDir)
          : await listCatalogModelsWithSdk(sdk, agentDir)
      // Plain data only: runtime model objects may carry non-cloneable members.
      result = models.map((m) => ({
        id: m.id,
        name: m.name,
        provider: m.provider,
        contextWindow: m.contextWindow,
        maxOutput: m.maxOutput,
        maxTokens: m.maxTokens,
        available: m.available,
        managedBy: m.managedBy,
        auth: m.auth ? JSON.parse(JSON.stringify(m.auth)) : undefined,
      }))
    } else if (message.type === 'context.preview') {
      const sdk = message.activeSdkPath
        ? await import(pathToFileURL(message.activeSdkPath).href)
        : await import('@earendil-works/pi-coding-agent')
      const sessionFile = String(message.payload.sessionFile || '')
      const leafId = message.payload.leafId as string | null | undefined
      const session = sdk.SessionManager.open(sessionFile)
      if (leafId === null) session.resetLeaf()
      else if (typeof leafId === 'string' && leafId.length > 0) session.branch(leafId)
      const context = session.buildSessionContext()
      result = buildSessionContextPreview({
        sessionId: session.getSessionId(),
        sessionFile,
        messages: (context.messages || []) as PiSessionMessage[],
      })
    } else if (message.type === 'extensions.probe') {
      // Resolve dirs exactly as the main process does (env overrides, WSL-aware agent dir).
      const { agentDir, desktopDir, homeDir } = message.payload as Record<string, string>
      setActiveDirResolvers({
        agentDir: () => agentDir,
        desktopDir: () => desktopDir,
        homeDir: () => homeDir,
      })
      invalidateAdapterCatalog()
      result = probeExtensions(String(message.payload.cwd || process.cwd()))
    } else if (message.type === 'pi.settings.get') {
      const sdk = message.activeSdkPath
        ? await import(pathToFileURL(message.activeSdkPath).href)
        : await import('@earendil-works/pi-coding-agent')
      const manager = sdk.SettingsManager.create(String(message.payload.cwd || process.cwd()), sdk.getAgentDir())
      result = piSettingsSnapshot(manager)
    } else if (message.type === 'pi.settings.set') {
      const sdk = message.activeSdkPath
        ? await import(pathToFileURL(message.activeSdkPath).href)
        : await import('@earendil-works/pi-coding-agent')
      const manager = sdk.SettingsManager.create(
        String(message.payload.cwd || process.cwd()),
        sdk.getAgentDir(),
        { projectTrusted: false },
      )
      await applyPiSettingsPatch(
        manager,
        (message.payload.patch as Record<string, unknown>) || {},
      )
      result = null
    } else if (message.type === 'system.prompt') {
      const sdk = message.activeSdkPath
        ? await import(pathToFileURL(message.activeSdkPath).href)
        : await import('@earendil-works/pi-coding-agent')
      result = await buildSystemPromptPreview(
        sdk,
        String(message.payload.cwd || process.cwd()),
        (message.payload.globalSettings as Record<string, unknown>) || {},
        (message.payload.projectSettings as Record<string, unknown>) || {},
      )
    } else {
      throw new Error(`Unknown preview request: ${String((message as { type?: string }).type)}`)
    }
    process.parentPort!.postMessage({ requestId: message.requestId, ok: true, result })
  } catch (error) {
    process.parentPort!.postMessage({
      requestId: message.requestId,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    })
  }
})
