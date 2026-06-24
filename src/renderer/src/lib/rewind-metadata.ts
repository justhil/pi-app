import { ipcClient } from '@renderer/lib/ipc-client'
import { useUIStore } from '@renderer/stores/ui-store'

/** 从当前会话 JSONL 加载树（与 TUI /tree 一致，不依赖 Worker 是否已 loadSession）。 */
export async function refreshSessionTree(sessionFile: string | null): Promise<void> {
  const store = useUIStore.getState()
  const key = sessionFile || ''
  store.setRewindMeta({ rewindKey: key, loadingTree: !!sessionFile })

  if (!sessionFile) {
    store.setRewindMeta({ treeNodes: [], workerBound: false, loadingTree: false })
    return
  }

  try {
    const treeRes = await ipcClient.invoke('session.tree', { sessionFile })
    if (useUIStore.getState().rewindKey !== key) return
    const nodes = (treeRes?.nodes || []) as Array<{
      id: string
      depth: number
      label?: string
      entryType: string
      isLeaf: boolean
    }>
    const leafId = treeRes?.leafId as string | null | undefined
    const withLeaf =
      leafId != null && leafId !== ''
        ? nodes.map((n) => ({ ...n, isLeaf: n.id === leafId }))
        : nodes
    store.setRewindMeta({
      treeNodes: withLeaf,
      workerBound: !!treeRes?.workerBound,
      loadingTree: false,
      treeError: treeRes?.error,
    })
  } catch (e) {
    console.error('[refreshSessionTree]', e)
    if (useUIStore.getState().rewindKey === key) {
      store.setRewindMeta({ loadingTree: false, treeError: 'error' })
    }
  }
}