// B-layer Extension Config Host: routes pendingExtensionConfig to adapter config pages.
// Per docs/tui-replacement-and-adapters.md §3, §5.

import { useEffect, useState } from 'react'
import { useUIStore } from '@renderer/stores/ui-store'
import { ipcClient } from '@renderer/lib/ipc-client'
import { X } from 'lucide-react'
import { ExtensionConfigForm } from './extension-config-form'

export function ExtensionConfigHost() {
  const pending = useUIStore((s) => s.pendingExtensionConfig)
  const requestExtensionConfig = useUIStore((s) => s.requestExtensionConfig)
  const workspace = useUIStore((s) => s.currentWorkspace)
  const [config, setConfig] = useState<Record<string, unknown>>({})
  const [schema, setSchema] = useState<Record<string, any> | null>(null)

  useEffect(() => {
    if (!pending) return
    ipcClient
      .invoke('extension.config.get', { extensionId: pending, workspaceId: workspace || '' })
      .then((res) => setConfig(res?.config || {}))
      .catch(() => setConfig({}))
    // Schema from built-in registry (B4 fetches from adapter; here we try adapters.catalog)
    ipcClient
      .invoke('adapters.catalog')
      .then((res) => {
        const hit = (res?.adapters || []).find((a: any) => a?.id === pending || a?.matchMeta?.npmPackage === pending)
        setSchema(hit ? { adapter: hit } : null)
      })
      .catch(() => setSchema(null))
  }, [pending, workspace])

  if (!pending) return null

  const close = () => requestExtensionConfig(null)

  const save = async (next: Record<string, unknown>) => {
    try {
      await ipcClient.invoke('extension.config.set', { extensionId: pending, workspaceId: workspace || '', config: next })
      setConfig(next)
    } catch (e) {
      console.error('extension.config.set failed:', e)
    }
  }

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/50 p-4" onClick={close}>
      <div
        className="w-full max-w-lg rounded-xl border border-border bg-background shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b px-5 py-3">
          <div>
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground/60">扩展配置</div>
            <div className="text-[14px] font-medium">{pending}</div>
          </div>
          <button onClick={close} className="rounded-md p-1 hover:bg-accent">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="max-h-[60vh] overflow-y-auto p-5">
          <ExtensionConfigForm
            extensionId={pending}
            config={config}
            schema={schema}
            onChange={save}
          />
        </div>
      </div>
    </div>
  )
}