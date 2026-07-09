import { toast } from 'sonner'
import { ipcClient } from '@renderer/lib/ipc-client'
import { useUIStore } from '@renderer/stores/ui-store'
import { refreshSessionTree } from '@renderer/lib/rewind-metadata'
import type { TimelineItem } from '@renderer/stores/ui-store-types'
import { captureFocusFromUiStore } from '@renderer/lib/session-shell'
import { getSessionMessagesFromDiskViaIpc } from '@renderer/lib/session-history'

/**
 * Rewind / jump to a session tree entry (pi navigateTree semantics).
 * After success, timeline is rebuilt from disk with the new leaf tip — never waits on
 * a full worker restart for the UI update.
 */
export async function navigateSessionToEntry(targetId: string): Promise<boolean> {
  console.log('[rewind] navigateSessionToEntry start, targetId=', targetId)
  try {
    const st = useUIStore.getState()
    const fromHistory = st.historySessionFile
    const fromSessions = st.sessions.find((s) => s.sessionId === st.currentSessionId)?.sessionFile
    const file = fromHistory ?? fromSessions
    console.log('[rewind] file resolution:', {
      fromHistory,
      fromSessions,
      file,
      currentSessionId: st.currentSessionId,
      targetId,
    })

    if (!file) {
      toast.warning('未找到会话文件，无法刷新时间线')
      return false
    }
    if (!targetId || !String(targetId).trim()) {
      toast.warning('无法回退：缺少消息节点 id')
      return false
    }

    // Bind + navigate on the session's worker (required for pi tree pointer).
    const r = (await ipcClient.invoke('session.navigateTree', {
      targetId,
      sessionFile: file,
      summarize: false,
    })) as {
      cancelled?: boolean
      error?: string
      editorText?: string
      leafId?: string | null
      sessionMeta?: { model?: string; thinkingLevel?: string }
    }
    console.log('[rewind] navigateTree response:', {
      cancelled: r?.cancelled,
      error: r?.error,
      leafId: r?.leafId,
      hasEditorText: !!(r?.editorText && r.editorText.length),
    })
    if (r?.cancelled || r?.error) {
      toast.error(r?.error || '跳转已取消')
      return false
    }

    const leafId =
      r?.leafId !== undefined && r.leafId !== null && String(r.leafId).length > 0
        ? r.leafId
        : targetId

    const editorText = typeof r?.editorText === 'string' ? r.editorText : ''
    if (editorText) st.setComposerPrefill(editorText)
    else st.setComposerPrefill(null)

    const { clearSessionHistoryCache, fetchSessionHistoryTail } = await import(
      '@renderer/lib/session-history'
    )
    clearSessionHistoryCache(file)
    try {
      const { clearLiveSessionTimeline } = await import('@renderer/lib/live-session-timeline-cache')
      clearLiveSessionTimeline(file)
    } catch {
      /* optional */
    }

    // Soft loading: keep current items visible while disk tail loads (no full skeleton flash).
    st.clearFileChanges()
    st.setRunState({
      status: 'idle',
      activeTool: undefined,
      activeToolStatus: undefined,
      activeRunId: undefined,
    })
    st.setWorkerLiveSnapshot({
      sessionId: st.currentSessionId,
      sessionFile: file,
      status: 'idle',
    })
    if (file) st.setSessionRuntimeRunning(file, false)
    useUIStore.setState({
      streamingAssistantId: null,
      agentTurnBootstrapping: false,
      optimisticPendingUserText: null,
    })

    try {
      // Disk path with explicit leaf — independent of worker survival after navigate.
      const hist = await fetchSessionHistoryTail(file, undefined, {
        bypassCache: true,
        leafId,
      })
      console.log('[rewind] history fetched:', {
        count: hist.items?.length,
        totalCount: hist.totalCount,
        error: hist.error,
        leafId,
      })
      // Rewind to first user message may yield empty branch (leaf = parent of first = null).
      // That is a valid empty chat state — never leave historyLoading true or Timeline skeleton.
      if (hist.error) {
        const disk = await getSessionMessagesFromDiskViaIpc(file, leafId)
        if (disk.error) {
          toast.error(hist.error || '回退后刷新历史失败')
          return false
        }
        const { sanitizeHistoryTimeline } = await import('@renderer/lib/timeline-dedupe')
        const items = sanitizeHistoryTimeline((disk.items || []) as TimelineItem[])
        st.loadHistoryItems(items)
        st.setHistoryMeta(disk.totalCount ?? items.length, items.length, file)
      } else {
        const { sanitizeHistoryTimeline } = await import('@renderer/lib/timeline-dedupe')
        const items = sanitizeHistoryTimeline((hist.items || []) as TimelineItem[])
        st.loadHistoryItems(items)
        st.setHistoryMeta(hist.totalCount ?? items.length, items.length, file)
      }

      st.setHistoryLoading(false)
      captureFocusFromUiStore()
      if (r?.sessionMeta?.model) st.setRunState({ model: r.sessionMeta.model })
      if (r?.sessionMeta?.thinkingLevel) {
        st.setRunState({ thinkingLevel: r.sessionMeta.thinkingLevel })
      }
      void refreshSessionTree(file)
      const { applyComposerDisplayMeta } = await import('@renderer/lib/session-display-meta')
      await applyComposerDisplayMeta(hist.sessionMeta ?? r?.sessionMeta)
    } finally {
      st.setHistoryLoading(false)
    }

    toast.success(
      editorText
        ? '已回退：消息已填入输入框，可修改后重新发送'
        : '已跳转到该节点，可从此继续',
    )
    return true
  } catch (e: unknown) {
    console.error('[rewind] navigateSessionToEntry error:', e)
    toast.error((e instanceof Error ? e.message : String(e)) || '回退失败')
    return false
  }
}
