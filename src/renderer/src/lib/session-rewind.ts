import { toast } from 'sonner'
import { ipcClient } from '@renderer/lib/ipc-client'
import { useUIStore } from '@renderer/stores/ui-store'
import { refreshSessionTree } from '@renderer/lib/rewind-metadata'
import type { TimelineItem } from '@renderer/stores/ui-store-types'

export async function navigateSessionToEntry(targetId: string): Promise<boolean> {
  console.log('[rewind] navigateSessionToEntry start, targetId=', targetId)
  try {
    const st = useUIStore.getState()
    const fromHistory = st.historySessionFile
    const fromSessions = st.sessions.find((s) => s.sessionId === st.currentSessionId)?.sessionFile
    const file = fromHistory ?? fromSessions
    console.log('[rewind] file resolution:', { fromHistory, fromSessions, file, currentSessionId: st.currentSessionId })

    if (!file) {
      toast.warning('未找到会话文件，无法刷新时间线')
      return false
    }

    const r = (await ipcClient.invoke('session.navigateTree', { targetId, sessionFile: file, summarize: false })) as {
      cancelled?: boolean
      error?: string
      editorText?: string
      sessionMeta?: { model?: string; thinkingLevel?: string }
    }
    console.log('[rewind] navigateTree response:', r)
    if (r?.cancelled) {
      toast.error(r?.error || '跳转已取消')
      return false
    }
    const editorText = typeof r?.editorText === 'string' ? r.editorText : ''
    if (editorText) st.setComposerPrefill(editorText)
    else st.setComposerPrefill(null)

    const { clearSessionHistoryCache, fetchSessionHistoryTail } = await import('@renderer/lib/session-history')
    clearSessionHistoryCache(file)
    st.setHistoryLoading(true)
    st.clearFileChanges()
    st.setRunState({ status: 'idle', activeTool: undefined, activeToolStatus: undefined })
    try {
      const hist = await fetchSessionHistoryTail(file, undefined, { bypassCache: true })
      console.log('[rewind] history fetched:', { count: hist.items?.length, totalCount: hist.totalCount })
      const { sanitizeHistoryTimeline } = await import('@renderer/lib/timeline-dedupe')
      const items = sanitizeHistoryTimeline(hist.items as TimelineItem[])
      st.loadHistoryItems(items)
      st.setHistoryMeta(hist.totalCount, items.length, file)
      if (r?.sessionMeta?.model) st.setRunState({ model: r.sessionMeta.model })
      if (r?.sessionMeta?.thinkingLevel) st.setRunState({ thinkingLevel: r.sessionMeta.thinkingLevel })
      void refreshSessionTree(file)
      const { applyComposerDisplayMeta } = await import('@renderer/lib/session-display-meta')
      await applyComposerDisplayMeta(hist.sessionMeta)
    } finally {
      st.setHistoryLoading(false)
    }
    toast.success('已跳转到该节点，可从此继续')
    return true
  } catch (e: unknown) {
    console.error('[rewind] navigateSessionToEntry error:', e)
    toast.error((e instanceof Error ? e.message : String(e)) || '回退失败')
    return false
  }
}