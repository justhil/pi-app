import { ipcClient } from '@renderer/lib/ipc-client'
import { useUIStore } from '@renderer/stores/ui-store'

/**
 * 并发刷新防护：refreshSessionTree 无缓存地读 JSONL，连续发送（或切换会话）会
 * 产生多个在途请求；较晚发出的请求若先返回，较早请求的旧文件快照会覆盖新树。
 * 用单调递增序号，只接受最新一次请求的响应。
 */
let rewindTreeRequestSeq = 0

/** 从当前会话 JSONL 加载树（与 TUI /tree 一致，不依赖 Worker 是否已 loadSession）。 */
export async function refreshSessionTree(sessionFile: string | null): Promise<void> {
  const store = useUIStore.getState()
  const key = sessionFile || ''
  const seq = ++rewindTreeRequestSeq
  store.setRewindMeta({ rewindKey: key, loadingTree: !!sessionFile })

  if (!sessionFile) {
    if (seq === rewindTreeRequestSeq) {
      store.setRewindMeta({ treeNodes: [], workerBound: false, loadingTree: false })
    }
    return
  }

  try {
    const treeRes = await ipcClient.invoke('session.tree', { sessionFile })
    // 过期响应丢弃：期间已有更新的请求发出，或已切到其它会话。
    if (seq !== rewindTreeRequestSeq || useUIStore.getState().rewindKey !== key) return
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
    if (seq === rewindTreeRequestSeq && useUIStore.getState().rewindKey === key) {
      store.setRewindMeta({ loadingTree: false, treeError: 'error' })
    }
  }
}