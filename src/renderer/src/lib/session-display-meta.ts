import { ipcClient } from '@renderer/lib/ipc-client'
import { useUIStore } from '@renderer/stores/ui-store'
import { normalizeModelKey, normalizeThinkingLevel } from '@renderer/lib/format-run-display'

export type SessionDisplayMeta = {
  model?: string
  thinkingLevel?: string
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

/** 合并：会话 JSONL 元数据优先，其次 Worker 状态，再次 pi 默认，最后持久化的 lastModel */
export async function applyComposerDisplayMeta(meta?: SessionDisplayMeta | null): Promise<void> {
  const store = useUIStore.getState()
  const patch: SessionDisplayMeta = {}

  const fromMetaModel = normalizeModelKey(meta?.model)
  const fromMetaThink = normalizeThinkingLevel(meta?.thinkingLevel)
  if (fromMetaModel) patch.model = fromMetaModel
  if (fromMetaThink) patch.thinkingLevel = fromMetaThink

  if (!patch.model || !patch.thinkingLevel) {
    try {
      const res = await ipcClient.invoke('runtime.getState' as any)
      const st = res?.state
      const wm = normalizeModelKey(st?.model)
      const wt = normalizeThinkingLevel(st?.thinkingLevel)
      if (!patch.model && wm) patch.model = wm
      if (!patch.thinkingLevel && wt) patch.thinkingLevel = wt
    } catch {
      /* worker not ready */
    }
  }

  if (!patch.model || !patch.thinkingLevel) {
    const defaults = await fetchPiDefaultDisplayMeta()
    const dm = normalizeModelKey(defaults.model)
    const dt = normalizeThinkingLevel(defaults.thinkingLevel)
    if (!patch.model && dm) patch.model = dm
    if (!patch.thinkingLevel && dt) patch.thinkingLevel = dt
  }

  const lm = normalizeModelKey(store.lastModel)
  const lt = normalizeThinkingLevel(store.lastThinking)
  if (!patch.model && lm) patch.model = lm
  if (!patch.thinkingLevel && lt) patch.thinkingLevel = lt

  const cur = store.runState
  const finalModel = patch.model ?? normalizeModelKey(cur.model)
  const finalThink = patch.thinkingLevel ?? normalizeThinkingLevel(cur.thinkingLevel) ?? 'off'
  store.setRunState({
    ...(finalModel ? { model: finalModel } : {}),
    thinkingLevel: finalThink,
  })
}