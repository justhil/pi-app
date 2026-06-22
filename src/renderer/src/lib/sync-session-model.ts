import { ipcClient } from '@renderer/lib/ipc-client'
import { useUIStore } from '@renderer/stores/ui-store'
import { normalizeModelKey } from '@renderer/lib/format-run-display'

/** 将 Pi 设置里的 defaultProvider/defaultModel 应用到当前 Worker 会话（与终端改默认后需 /model 类似） */
export async function applyPiDefaultModelToWorkerSession(): Promise<void> {
  const res = await ipcClient.invoke('pi.settings.get', {})
  const s = res?.settings as { defaultProvider?: string; defaultModel?: string } | undefined
  const provider = s?.defaultProvider?.trim()
  const modelId = s?.defaultModel?.trim()
  if (!provider || !modelId) return

  const key = `${provider}/${modelId}`
  try {
    await ipcClient.invoke('model.set', { sessionId: '', provider, modelId })
    const st = await ipcClient.invoke('runtime.getState' as any)
    const wm = normalizeModelKey(st?.state?.model) ?? key
    useUIStore.getState().setRunState({ model: wm })
  } catch (e) {
    console.error('[applyPiDefaultModelToWorkerSession]', e)
    throw e
  }
}