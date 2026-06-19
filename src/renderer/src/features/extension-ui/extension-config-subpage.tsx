// Embedded extension config subpage (replaces modal). Same look as other settings pages.

import { useEffect, useState } from 'react'
import { ipcClient } from '@renderer/lib/ipc-client'
import { useUIStore } from '@renderer/stores/ui-store'
import { ExtensionConfigForm } from './extension-config-form'
import { AdapterConfigPanel } from './adapter-config-panel'
import type { AdapterJson } from '../../../../extension-compat/adapter-schema'

export function ExtensionConfigSubpage({ extensionId }: { extensionId: string }) {
  const workspace = useUIStore((s) => s.currentWorkspace)
  const [config, setConfig] = useState<Record<string, unknown>>({})
  const [adapter, setAdapter] = useState<any>(null)
  const [jsonAdapter, setJsonAdapter] = useState<AdapterJson | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([
      ipcClient.invoke('extension.config.get', { extensionId, workspaceId: workspace || '' }),
      ipcClient.invoke('adapters.catalog'),
      ipcClient.invoke('adapters.json.catalog'),
    ])
      .then(([cfgRes, catRes, jsonRes]) => {
        setConfig(cfgRes?.config || {})
        const hit = (catRes?.adapters || []).find((a: any) => a?.id === extensionId || a?.matchMeta?.npmPackage === extensionId)
        setAdapter(hit || null)
        // v2: match by id / match.names (plugin package name)
        const jhit = (jsonRes?.adapters || []).find((a: AdapterJson) =>
          a.id === extensionId || (a.match?.names || []).some((n) => extensionId === n || extensionId.endsWith(n) || extensionId.includes(n)))
        setJsonAdapter(jhit || null)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [extensionId, workspace])

  const save = async (next: Record<string, unknown>) => {
    setConfig(next)
    try {
      await ipcClient.invoke('extension.config.set', { extensionId, workspaceId: workspace || '', config: next })
    } catch (e) {
      console.error('extension.config.set failed:', e)
    }
  }

  if (loading) return <div className="text-[12px] text-muted-foreground/50">加载中…</div>

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-[15px] font-semibold">{adapter?.displayName || extensionId}</h3>
        {adapter?.description && <p className="mt-0.5 text-[12px] text-muted-foreground/70">{adapter.description}</p>}
      </div>

      {adapter?.desktopSupport && (
        <div className="rounded-lg border border-border/50 bg-muted/30 p-3 text-[12px] text-muted-foreground">
          <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">桌面支持</div>
          <div className="mt-0.5">{adapter.desktopSupport}</div>
        </div>
      )}

      {/* v2 adapter.json takes precedence; legacy ExtensionConfigForm is fallback (dual-track) */}
      {jsonAdapter ? (
        <AdapterConfigPanel adapter={jsonAdapter} />
      ) : (
        <ExtensionConfigForm
          extensionId={extensionId}
          config={config}
          adapter={adapter ? { displayName: adapter.displayName, desktopSupport: adapter.desktopSupport, configKeys: adapter.configKeys, configNote: adapter.configNote } : null}
          onChange={save}
        />
      )}

      {adapter?.registeredTools?.length > 0 && (
        <div>
          <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60 mb-1.5">注册的工具</div>
          <div className="flex flex-wrap gap-1">
            {adapter.registeredTools.map((t: string) => (
              <span key={t} className="rounded bg-muted/70 px-1.5 py-0.5 font-mono text-[10px]">{t}</span>
            ))}
          </div>
        </div>
      )}

      {adapter?.registeredCommands?.length > 0 && (
        <div>
          <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60 mb-1.5">注册的命令</div>
          <div className="flex flex-wrap gap-1">
            {adapter.registeredCommands.map((c: string) => (
              <span key={c} className="rounded bg-muted/70 px-1.5 py-0.5 font-mono text-[10px]">/{c}</span>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}