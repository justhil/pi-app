import { useEffect, useState } from 'react'
import { ipcClient } from '@renderer/lib/ipc-client'
import { useUIStore } from '@renderer/stores/ui-store'

export function McpDiagnostics() {
  const workspace = useUIStore((s) => s.currentWorkspace)
  const [exts, setExts] = useState<Array<{ id?: string; packageName?: string; name?: string; compatibility?: string }>>([])

  useEffect(() => {
    if (!workspace) return
    ipcClient.invoke('extensions.list', { workspaceId: workspace }).then((r) => {
      const list = r?.extensions || []
      setExts((list as Array<{ id?: string; packageName?: string; name?: string; compatibility?: string }>).filter((e) => (e.packageName || e.name || '').includes('mcp')))
    })
  }, [workspace])

  return (
    <div className="space-y-3 rounded-lg border border-dashed border-border/60 bg-muted/15 p-4 text-[12px]">
      <div className="font-medium text-foreground/90">MCP 适配器诊断（只读）</div>
      <ul className="list-disc space-y-1 pl-4 text-muted-foreground/80">
        <li>MCP 连接与服务器列表由 pi-mcp-adapter 在 pi 运行时自管，桌面不写配置。</li>
        <li>在终端用 pi 的 MCP 相关斜杠/设置完成连接后，工具会出现在 Agent 工具列表。</li>
        <li>环境变量与 ~/.pi/agent 下的 MCP 配置以扩展文档为准。</li>
      </ul>
      {exts.length > 0 && (
        <div>
          <div className="text-[10px] uppercase text-muted-foreground/50">探测到的包</div>
          {exts.map((e) => (
            <div key={e.id} className="font-mono text-[11px]">
              {e.packageName || e.name} — {e.compatibility}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}