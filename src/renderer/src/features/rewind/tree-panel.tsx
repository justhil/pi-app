import { useCallback, useEffect } from 'react'
import { Loader2, RefreshCw } from 'lucide-react'
import { useUIStore } from '@renderer/stores/ui-store'
import { navigateSessionToEntry } from '@renderer/lib/session-rewind'
import { refreshSessionTree } from '@renderer/lib/rewind-metadata'
import { capSessionTreeForDisplay } from '@renderer/features/rewind/session-tree-display-cap'
import { SessionTreeList, type SessionTreeNode } from '@renderer/features/rewind/session-tree-list'

export function TreePanel() {
  const workspace = useUIStore((s) => s.currentWorkspace)
  const sessionFile = useUIStore((s) => s.historySessionFile)
  const tree = useUIStore((s) => s.rewindTreeNodes) as SessionTreeNode[]
  const loading = useUIStore((s) => s.rewindLoadingTree)
  const treeError = useUIStore((s) => s.rewindTreeError)

  const refresh = useCallback(() => {
    if (!sessionFile) return
    void refreshSessionTree(sessionFile)
  }, [sessionFile])

  useEffect(() => {
    if (sessionFile && tree.length === 0 && !loading && !treeError) {
      void refreshSessionTree(sessionFile)
    }
  }, [sessionFile, tree.length, loading, treeError])

  if (!workspace) {
    return <div className="p-4 text-[12px] text-muted-foreground">请先打开工作区</div>
  }

  return (
    <div className="flex h-full flex-col text-[12px]">
      <div className="flex items-center justify-between border-b border-border/50 px-3 py-2">
        <span className="font-medium text-foreground-secondary">会话树</span>
        <button type="button" className="rounded p-1 hover:bg-muted" title="刷新" onClick={refresh} disabled={!sessionFile}>
          <RefreshCw className="h-3.5 w-3.5" />
        </button>
      </div>

      <p className="border-b border-border/30 px-3 py-2 text-[10px] text-muted-foreground leading-relaxed">
等同 TUI <span className="font-mono">/tree</span>：点用户消息会回到发送前（正文进输入框）；点助手消息则保留到该条回复。
      </p>

      <div className="scrollbar-overlay min-h-0 flex-1 overflow-y-auto overflow-x-hidden py-1">
        {!sessionFile ? (
          <p className="px-3 py-6 text-[11px] text-muted-foreground/70">未选择会话</p>
        ) : loading ? (
          <div className="flex items-center gap-2 px-3 py-6 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            加载…
          </div>
        ) : treeError ? (
          <p className="px-3 py-6 text-[11px] text-destructive/80">加载失败：{treeError}</p>
        ) : tree.length === 0 ? (
          <p className="px-3 py-6 text-[11px] text-muted-foreground/70">树为空</p>
        ) : (
          (() => {
            const { nodes: display, truncated, hiddenCount } = capSessionTreeForDisplay(tree)
            return (
              <>
                {truncated && (
                  <p className="px-3 pb-1 text-[10px] text-muted-foreground/80">
                    显示最近 {display.length} 节点，省略 {hiddenCount} 个
                  </p>
                )}
                <SessionTreeList
                  className="px-1"
                  rowClassName="text-[11px]"
                  nodes={display}
                  onActivate={(id) => void navigateSessionToEntry(id)}
                  showGuides={display.length <= 120}
                />
              </>
            )
          })()
        )}
      </div>
    </div>
  )
}