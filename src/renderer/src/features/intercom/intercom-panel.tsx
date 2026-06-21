import { useEffect, useState } from 'react'
import { ipcClient } from '@renderer/lib/ipc-client'
import { useUIStore } from '@renderer/stores/ui-store'
import { Radio } from 'lucide-react'

export function IntercomPanel() {
  const workspace = useUIStore((s) => s.currentWorkspace)
  const [snap, setSnap] = useState<any>(null)

  useEffect(() => {
    ipcClient.invoke('intercom.snapshot').then(setSnap).catch(() => setSnap(null))
  }, [workspace])

  return (
    <div className="scrollbar-overlay flex h-full flex-col overflow-y-auto p-3">
      <div className="mb-2 flex items-center gap-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground/60">
        <Radio className="h-3.5 w-3.5" />
        Intercom（只读）
      </div>
      {(snap?.notes || []).map((n: string, i: number) => (
        <p key={i} className="mb-1 text-[12px] text-muted-foreground/80">
          {n}
        </p>
      ))}
      {snap?.config && (
        <pre className="mt-2 max-h-48 overflow-auto rounded-lg border border-border/50 bg-muted/20 p-2 font-mono text-[10px]">
          {JSON.stringify(snap.config, null, 2)}
        </pre>
      )}
      <p className="mt-3 text-[10px] text-muted-foreground/45">
        实时跨会话消息仍由 pi-intercom 扩展处理；桌面不替代 broker，仅诊断与路径说明。
      </p>
    </div>
  )
}