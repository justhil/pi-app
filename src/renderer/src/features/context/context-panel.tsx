import { useEffect, useState } from 'react'
import { ipcClient } from '@renderer/lib/ipc-client'
import { useUIStore } from '@renderer/stores/ui-store'
import { RefreshCw } from 'lucide-react'

export function ContextPanel() {
  const workspace = useUIStore((s) => s.currentWorkspace)
  const [preview, setPreview] = useState<any>(null)
  const [loading, setLoading] = useState(false)

  const load = () => {
    if (!workspace) return
    setLoading(true)
    ipcClient
      .invoke('context.preview')
      .then((r) => setPreview(r?.preview || null))
      .catch(() => setPreview(null))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    load()
  }, [workspace])

  if (!workspace) {
    return <div className="p-3 text-[12px] text-muted-foreground/50">请先打开项目</div>
  }

  return (
    <div className="flex h-full flex-col overflow-hidden p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground/60">会话上下文</span>
        <button type="button" onClick={load} className="rounded p-1 hover:bg-accent" title="刷新">
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>
      {!preview ? (
        <div className="text-[12px] text-muted-foreground/60">Worker 未就绪或无会话</div>
      ) : (
        <>
          <div className="mb-3 grid grid-cols-2 gap-2 text-[11px]">
            <div className="rounded-md border border-border/50 bg-muted/20 px-2 py-1.5">
              <div className="text-muted-foreground/60">消息数</div>
              <div className="font-mono font-medium">{preview.messageCount}</div>
            </div>
            <div className="rounded-md border border-border/50 bg-muted/20 px-2 py-1.5">
              <div className="text-muted-foreground/60">约字符</div>
              <div className="font-mono font-medium">{preview.estimatedChars}</div>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto rounded-lg border border-border/50 bg-muted/10 p-2">
            <div className="text-[10px] text-muted-foreground/50 mb-1">最近片段（只读）</div>
            {(preview.snippets || []).map((s: string, i: number) => (
              <pre key={i} className="mb-2 whitespace-pre-wrap break-words font-mono text-[10px] text-foreground/80">
                {s}
              </pre>
            ))}
          </div>
        </>
      )}
      <p className="mt-2 text-[10px] text-muted-foreground/45">
        对应 @agnishc/edb-context-viewer 的只读桌面等价；完整 TUI 视图不复刻。
      </p>
    </div>
  )
}