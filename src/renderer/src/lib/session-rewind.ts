import { toast } from 'sonner'
import { ipcClient } from '@renderer/lib/ipc-client'
import { useUIStore } from '@renderer/stores/ui-store'
import { refreshSessionTree } from '@renderer/lib/rewind-metadata'

export async function navigateSessionToEntry(targetId: string): Promise<boolean> {
  try {
    const r = await ipcClient.invoke('session.navigateTree', { targetId, summarize: false })
    if (r?.cancelled) {
      toast.info('已取消')
      return false
    }
    const st = useUIStore.getState()
    const editorText = typeof r?.editorText === 'string' ? r.editorText : ''
    if (editorText) st.setComposerPrefill(editorText)
    toast.success('已跳转到该节点，可从此继续')
    const file =
      st.historySessionFile ?? st.sessions.find((s) => s.sessionId === st.currentSessionId)?.sessionFile
    if (file) {
      const { clearSessionHistoryCache, fetchSessionHistoryTail } = await import('@renderer/lib/session-history')
      clearSessionHistoryCache(file)
      st.clearFileChanges()
      st.setRunState({ status: 'idle', activeTool: undefined, activeToolStatus: undefined })
      const hist = await fetchSessionHistoryTail(file)
      st.loadHistoryItems(hist.items as any[])
      st.setHistoryMeta(hist.totalCount, hist.items.length, file)
      if (r?.sessionMeta?.model) st.setRunState({ model: r.sessionMeta.model })
      if (r?.sessionMeta?.thinkingLevel) st.setRunState({ thinkingLevel: r.sessionMeta.thinkingLevel })
      void refreshSessionTree(file)
    }
    return true
  } catch (e: any) {
    toast.error(e?.message || '回退失败')
    return false
  }
}