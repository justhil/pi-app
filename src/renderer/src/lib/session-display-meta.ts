import { toast } from 'sonner'
import { ipcClient } from '@renderer/lib/ipc-client'
import { useUIStore } from '@renderer/stores/ui-store'
import { normalizeModelKey, normalizeThinkingLevel } from '@renderer/lib/format-run-display'
import { isViewingWorkerBoundSession } from '@renderer/lib/session-worker-sync'

export type SessionDisplayMeta = {
  model?: string
  thinkingLevel?: string
  modelFallbackMessage?: string
}

/** 从 pi 全局 settings 读取默认模型 / thinking（Worker 未绑会话时也能显示） */
export async function fetchPiDefaultDisplayMeta(): Promise<SessionDisplayMeta> {
  try {
    const res = await ipcClient.invoke('pi.settings.get', {})
    const s = res?.settings
    if (!s) return {}
    const out: SessionDisplayMeta = {}
    if (s.defaultThinkingLevel) out.thinkingLevel = String(s.defaultThinkingLevel)
    const provider = s.defaultProvider
    const modelId = s.defaultModel
    if (provider && modelId) out.model = `${provider}/${modelId}`
    else if (modelId && String(modelId).includes('/')) out.model = String(modelId)
    return out
  } catch {
    return {}
  }
}

/** Show SDK model-restore fallback once (toast). Safe to call from event handlers. */
export function notifyModelFallback(message: string | null | undefined): void {
  const text = String(message || '').trim()
  if (!text) return
  toast.warning(text, { duration: 12_000, id: `model-fallback:${text}` })
}

/**
 * Apply live Worker model/thinking after bind (loadSession / prompt.send).
 * Runtime is authoritative — never keep JSONL meta when Worker is bound to the viewed session.
 */
export function applyWorkerBoundModelDisplay(result: {
  model?: string | null
  thinkingLevel?: string | null
  modelFallbackMessage?: string | null
}): void {
  const store = useUIStore.getState()
  const wm = normalizeModelKey(result.model)
  const wt = normalizeThinkingLevel(result.thinkingLevel)
  const patch: SessionDisplayMeta = {}
  if (wm) patch.model = wm
  if (wt) patch.thinkingLevel = wt
  if (Object.keys(patch).length > 0) store.setRunState(patch)
  notifyModelFallback(result.modelFallbackMessage)
}

/**
 * Composer model/thinking display merge.
 *
 * When Worker is bound to the currently viewed session, runtime model/thinking are
 * authoritative — JSONL sessionMeta must not cover them (issue #19).
 * JSONL / pi defaults / lastModel only apply while unbound / preview-only.
 */
export async function applyComposerDisplayMeta(meta?: SessionDisplayMeta | null): Promise<void> {
  const store = useUIStore.getState()
  const patch: SessionDisplayMeta = {}

  const previewFile = store.historySessionFile
  let workerBoundToView = !previewFile
  let workerModel: string | undefined
  let workerThinking: string | undefined

  try {
    const res = await ipcClient.invoke('ipc:runtime.getState', {})
    const st = res?.state as { sessionFile?: string; model?: string; thinkingLevel?: string } | null
    if (previewFile) {
      workerBoundToView = isViewingWorkerBoundSession(previewFile, st?.sessionFile)
    } else if (st?.sessionFile) {
      workerBoundToView = true
    }
    if (workerBoundToView && st) {
      workerModel = normalizeModelKey(st.model)
      workerThinking = normalizeThinkingLevel(st.thinkingLevel)
      if (workerModel) patch.model = workerModel
      if (workerThinking) patch.thinkingLevel = workerThinking
    }
  } catch {
    /* worker not ready */
  }

  // Bound: runtime only (plus fill missing thinking from defaults/last). Never JSONL model.
  // Unbound preview: JSONL meta is OK for display until first bind.
  if (!workerBoundToView) {
    const fromMetaModel = normalizeModelKey(meta?.model)
    const fromMetaThink = normalizeThinkingLevel(meta?.thinkingLevel)
    if (!patch.model && fromMetaModel) patch.model = fromMetaModel
    if (!patch.thinkingLevel && fromMetaThink) patch.thinkingLevel = fromMetaThink
  }

  if (!patch.model || !patch.thinkingLevel) {
    const defaults = await fetchPiDefaultDisplayMeta()
    const dm = normalizeModelKey(defaults.model)
    const dt = normalizeThinkingLevel(defaults.thinkingLevel)
    // When bound, do not invent a different model from pi defaults — only fill thinking.
    if (!workerBoundToView && !patch.model && dm) patch.model = dm
    if (!patch.thinkingLevel && dt) patch.thinkingLevel = dt
  }

  const lm = normalizeModelKey(store.lastModel)
  const lt = normalizeThinkingLevel(store.lastThinking)
  if (!workerBoundToView && !patch.model && lm) patch.model = lm
  if (!patch.thinkingLevel && lt) patch.thinkingLevel = lt

  const cur = store.runState
  // Bound without a model key: clear stale display rather than keep JSONL/lastModel
  let finalModel = patch.model ?? (!workerBoundToView ? normalizeModelKey(cur.model) : undefined)
  if (workerBoundToView && workerModel) finalModel = workerModel
  if (workerBoundToView && !workerModel) finalModel = undefined

  const finalThink =
    patch.thinkingLevel ??
    workerThinking ??
    normalizeThinkingLevel(cur.thinkingLevel) ??
    'off'

  store.setRunState({
    model: finalModel,
    thinkingLevel: finalThink,
  })

  notifyModelFallback(meta?.modelFallbackMessage)
}
