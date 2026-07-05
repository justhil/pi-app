import type {
  AgentSession,
  AgentSessionEvent,
  EventBus,
} from '@earendil-works/pi-coding-agent'
import type { AppEvent } from '@shared/app-events'
import { formatSessionModelKey, type SessionModelRef } from '@shared/worker-model'
import { createDesktopUIBridge, type DesktopUIBridge } from './desktop-ui-bridge.js'
import { handleSessionEvent as dispatchSessionEvent } from './worker-session-events.js'
import { errorMessage } from '@shared/error-message'

export type WorkerMutableState = {
  sdk: typeof import('@earendil-works/pi-coding-agent') | null
  activeSdkPath: string | null
  sharedEventBus: EventBus | null
  session: AgentSession | null
  uiBridge: DesktopUIBridge | null
  seq: number
  currentCwd: string
  currentSessionId: string
  currentRunId: string
  currentTurnId: string
  unsubscribe: (() => void) | null
  agentTurnActive: boolean
  promptSent: boolean
}

export const st: WorkerMutableState = {
  sdk: null,
  activeSdkPath: null,
  sharedEventBus: null,
  session: null,
  uiBridge: null,
  seq: 0,
  currentCwd: '',
  currentSessionId: '',
  currentRunId: '',
  currentTurnId: '',
  unsubscribe: null,
  agentTurnActive: false,
  promptSent: false,
}

function nextSeq(): number {
  return ++st.seq
}

export function emit(event: AppEvent): void {
  process.parentPort?.postMessage({ type: 'app-event', event })
}

function now(): number {
  return Date.now()
}

export function currentSessionModelKey(): string | undefined {
  return st.session ? formatSessionModelKey(st.session.model as SessionModelRef) : undefined
}

export function baseEvent() {
  return {
    seq: nextSeq(),
    workspaceId: st.currentCwd,
    sessionId: st.currentSessionId,
    sessionFile: st.session?.sessionFile,
    runId: st.currentRunId,
    turnId: st.currentTurnId,
    timestamp: now(),
  }
}

export async function initSession(cwd: string): Promise<void> {
  if (st.unsubscribe) {
    st.unsubscribe()
    st.unsubscribe = null
  }
  st.agentTurnActive = false
  st.promptSent = false
  if (st.session) {
    st.session.dispose()
    st.session = null
  }

  st.currentCwd = cwd

  const agentDir = st.sdk!.getAgentDir()
  const settingsManager = st.sdk!.SettingsManager.create(cwd, agentDir)
  const resourceLoader = new st.sdk!.DefaultResourceLoader({
    cwd,
    agentDir,
    settingsManager,
    eventBus: st.sharedEventBus!,
  })
  await resourceLoader.reload()

  const { session: newSession, modelFallbackMessage } = await st.sdk!.createAgentSession({
    cwd,
    agentDir,
    settingsManager,
    resourceLoader,
    sessionManager: st.sdk!.SessionManager.create(cwd),
  })

  st.session = newSession
  st.currentSessionId = st.session.sessionId
  await bindDesktopExtensions(st.session)

  st.unsubscribe = st.session.subscribe((event: AgentSessionEvent) => {
    handleSessionEvent(event)
  })

  if (st.session) {
    const modelStr = currentSessionModelKey()
    emit({ ...baseEvent(), type: 'run', phase: 'state', model: modelStr, thinkingLevel: st.session.thinkingLevel })
  }

  if (modelFallbackMessage) {
    console.warn('[Worker] Model fallback:', modelFallbackMessage)
  }
}

function buildCommandContextActions(sess: AgentSession) {
  return {
    waitForIdle: () => sess.agent.waitForIdle(),
    newSession: async () => ({ cancelled: true }),
    fork: async () => ({ cancelled: true }),
    navigateTree: async (targetId: string, options?: { summarize?: boolean; customInstructions?: string; replaceInstructions?: boolean; label?: string }) => {
      const result = await sess.navigateTree(targetId, {
        summarize: options?.summarize ?? false,
        customInstructions: options?.customInstructions,
        replaceInstructions: options?.replaceInstructions,
        label: options?.label,
      })
      return { cancelled: result.cancelled }
    },
    switchSession: async () => ({ cancelled: true }),
    reload: async () => {
      await sess.reload()
    },
  }
}

function workerTraceOn(): boolean {
  return (
    process.env.PI_AUDIO_TRACE === '1' ||
    process.env.PI_AUDIO_TRACE === 'true' ||
    process.env.PI_ALERT_TRACE === '1'
  )
}

function traceWorkerUi(req: import('./desktop-ui-bridge.js').ExtensionUIRequest, forwarded: boolean): void {
  if (!workerTraceOn()) return
  const detail =
    req.method === 'notify'
      ? { method: 'notify', notifyType: req.notifyType, msg: String(req.message || '').slice(0, 100) }
      : { method: req.method, kind: (req as { kind?: string }).kind }
  console.log('[audio-trace] worker.postExtensionUi', { forwarded, agentTurnActive: st.agentTurnActive, ...detail })
}

function postExtensionUiToDesktop(req: import('./desktop-ui-bridge.js').ExtensionUIRequest): void {
  if (req.method === 'notify') {
    if (!st.agentTurnActive) {
      if (req.notifyType === 'error') {
        traceWorkerUi(req, true)
        process.parentPort?.postMessage({ type: 'extension-ui-request', request: req })
      } else {
        traceWorkerUi(req, false)
      }
      return
    }
  }
  traceWorkerUi(req, true)
  process.parentPort?.postMessage({ type: 'extension-ui-request', request: req })
}

function postExtensionUiDismiss(id: string, reason: 'timeout' | 'abort'): void {
  process.parentPort?.postMessage({ type: 'extension-ui-dismiss', id, reason })
}

export async function bindDesktopExtensions(sess: AgentSession): Promise<void> {
  if (!st.uiBridge) {
    st.uiBridge = createDesktopUIBridge(st.sharedEventBus!, postExtensionUiToDesktop, postExtensionUiDismiss)
  }
  await sess.bindExtensions({
    uiContext: st.uiBridge.uiContext as never,
    mode: 'rpc',
    commandContextActions: buildCommandContextActions(sess),
  })
}

function sessionEventDeps() {
  return {
    baseEvent,
    emit,
    getSession: () => st.session,
    getSessionModelKey: currentSessionModelKey,
    getUiBridge: () => st.uiBridge,
    isAgentTurnActive: () => st.agentTurnActive,
    setAgentTurnActive: (v: boolean) => {
      st.agentTurnActive = v
    },
    setCurrentRunId: (id: string) => {
      st.currentRunId = id
    },
    setCurrentTurnId: (id: string) => {
      st.currentTurnId = id
    },
    nextSeq,
  }
}

export function handleSessionEvent(event: AgentSessionEvent): void {
  dispatchSessionEvent(event, sessionEventDeps())
}

export async function listSessions(cwd: string): Promise<unknown[]> {
  if (!st.sdk) return []
  try {
    return await st.sdk.SessionManager.list(cwd)
  } catch (e) {
    console.error('[Worker] listSessions failed:', e)
    return []
  }
}