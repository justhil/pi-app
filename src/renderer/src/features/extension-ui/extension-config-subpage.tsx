// Embedded extension config subpage (v2-only). All metadata from adapter.json catalog.

import { useEffect, useState } from 'react'
import { ipcClient } from '@renderer/lib/ipc-client'
import { useUIStore } from '@renderer/stores/ui-store'
import { AdapterConfigPanel } from './adapter-config-panel'
import { CUSTOM_CONFIG_RENDERERS } from './custom-config-renderers'
import type { AdapterJson } from '@extension-compat/adapter-schema'

export function ExtensionConfigSubpage({ extensionId }: { extensionId: string }) {
  const workspace = useUIStore((s) => s.currentWorkspace)
  const [jsonAdapter, setJsonAdapter] = useState<AdapterJson | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    ipcClient
      .invoke('adapters.json.catalog')
      .then((res) => {
        const hit = (res?.adapters || []).find(
          (a: AdapterJson) =>
            a.id === extensionId ||
            (a.match?.names || []).some((n) => extensionId === n || extensionId.endsWith(n) || extensionId.includes(n)),
        )
        setJsonAdapter(hit || null)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [extensionId])

  if (loading) return <div className="text-[12px] text-muted-foreground/50">加载中…</div>

  const info = jsonAdapter
    ? {
        displayName: jsonAdapter.displayName || extensionId,
        description: jsonAdapter.description,
        tools: jsonAdapter.match?.tools || [],
        commands: Array.from(
          new Set([
            ...Object.keys(jsonAdapter.slash || {}),
            ...(jsonAdapter.match?.commands || []).map((c) => (c.startsWith('/') ? c : `/${c}`)),
          ]),
        ),
      }
    : { displayName: extensionId, description: '', tools: [], commands: [] }

  // Dynamic specialized renderer (skills-manager / mcp) takes precedence when declared.
  const CustomRenderer = jsonAdapter?.config?.customRenderer
    ? CUSTOM_CONFIG_RENDERERS[jsonAdapter.config.customRenderer]
    : null

  const saveAppLocal = async (next: Record<string, unknown>) => {
    try {
      await ipcClient.invoke('extension.config.set', { extensionId, workspaceId: workspace || '', config: next })
    } catch (e) {
      console.error('extension.config.set failed:', e)
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-[15px] font-semibold">{info.displayName}</h3>
        {info.description && <p className="mt-0.5 text-[12px] text-muted-foreground/70">{info.description}</p>}
      </div>

      {jsonAdapter ? (
        CustomRenderer ? (
          <CustomRenderer extensionId={extensionId} workspace={workspace || ''} onChange={saveAppLocal} />
        ) : (
          <AdapterConfigPanel adapter={jsonAdapter} />
        )
      ) : (
        <div className="rounded-lg border border-dashed border-border/60 bg-muted/20 p-4">
          <div className="text-[12px] font-medium text-foreground/80">未登记桌面适配</div>
          <div className="mt-1 text-[12px] text-muted-foreground/70">
            该扩展尚未登记桌面适配器（adapter.json）。如需接入，请在兼容层声明。
          </div>
        </div>
      )}

      {info.tools.length > 0 && (
        <div>
          <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60 mb-1.5">注册的工具</div>
          <div className="flex flex-wrap gap-1">
            {info.tools.map((t) => (
              <span key={t} className="rounded bg-muted/70 px-1.5 py-0.5 font-mono text-[10px]">{t}</span>
            ))}
          </div>
        </div>
      )}

      {info.commands.length > 0 && (
        <div>
          <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60 mb-1.5">注册的命令</div>
          <div className="flex flex-wrap gap-1">
            {info.commands.map((c) => (
              <span key={c} className="rounded bg-muted/70 px-1.5 py-0.5 font-mono text-[10px]">{c}</span>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
