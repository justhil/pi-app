import { useEffect, useState } from 'react'
import { ipcClient } from '@renderer/lib/ipc-client'
import { useUIStore } from '@renderer/stores/ui-store'
import type { SidePanelComponentProps } from './side-panel-registry'

/** 默认适配器右栏：拉取 adapter.sidePanel.getState 并以 JSON 树展示（可后续换 schema 视图）。 */
export function GenericAdapterSidePanel({ panelId, adapterId }: SidePanelComponentProps) {
  const workspace = useUIStore((s) => s.currentWorkspace)
  const [state, setState] = useState<unknown>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const load = async () => {
    if (!workspace || !adapterId) return
    setLoading(true)
    setError(null)
    try {
      const res = await ipcClient.invoke('adapter.sidePanel.getState', { adapterId, workspaceId: workspace })
      if (!res?.ok) {
        setError(res?.error || 'load_failed')
        setState(null)
      } else {
        setState(res.state)
      }
    } catch (e) {
      setError(String(e))
    }
    setLoading(false)
  }

  useEffect(() => {
    void load()
  }, [workspace, adapterId])

  if (!workspace) {
    return <div className="p-4 text-[12px] text-muted-foreground">请先打开项目</div>
  }
  if (!adapterId) {
    return <div className="p-4 text-[12px] text-muted-foreground">未绑定 adapterId（panel: {panelId}）</div>
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex items-center justify-between border-b border-border/40 px-3 py-2">
        <span className="font-mono text-[11px] text-muted-foreground">{panelId}</span>
        <button type="button" onClick={() => void load()} className="text-[11px] text-primary hover:underline" disabled={loading}>
          刷新
        </button>
      </div>
      <div className="flex-1 overflow-auto p-3">
        {loading && <div className="text-[12px] text-muted-foreground">加载中…</div>}
        {error && <div className="text-[12px] text-destructive">{error}</div>}
        {!loading && !error && (
          <pre className="whitespace-pre-wrap break-words rounded-md border border-border/40 bg-muted/30 p-2 font-mono text-[10px]">
            {JSON.stringify(state, null, 2)}
          </pre>
        )}
      </div>
    </div>
  )
}