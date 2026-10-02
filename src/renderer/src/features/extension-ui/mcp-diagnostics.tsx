import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ipcClient } from '@renderer/lib/ipc-client'
import { useUIStore } from '@renderer/stores/ui-store'

export function McpDiagnostics() {
  const { t } = useTranslation()
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
      <div className="font-medium text-foreground/90">{t('extension:mcpTitle')}</div>
      <ul className="list-disc space-y-1 pl-4 text-muted-foreground/80">
        <li>{t('extension:mcpNoteManaged')}</li>
        <li>{t('extension:mcpNoteConnect')}</li>
        <li>{t('extension:mcpNoteConfig')}</li>
      </ul>
      {exts.length > 0 && (
        <div>
          <div className="text-[10px] uppercase text-muted-foreground/50">{t('extension:mcpPackages')}</div>
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