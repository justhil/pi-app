// Minimal schema-aware config form. B4 will expand to full JSON Schema rendering.
// For now: render a generic key/value editor + a few built-in adapter defaults.

import { useMemo, useState } from 'react'

interface Props {
  extensionId: string
  config: Record<string, unknown>
  schema: Record<string, any> | null
  onChange: (next: Record<string, unknown>) => void
}

// Built-in defaults for adapters that have known config surfaces.
const BUILTIN_DEFAULTS: Record<string, Record<string, unknown>> = {
  trellis: { showRecentJournal: true, journalLimit: 5 },
  '@juicesharp/rpiv-ask-user-question': { language: 'zh', enablePreview: true },
  'pi-studio': { autoExport: false },
  'pi-cache-optimizer': { enabled: true },
  'pi-multimodal-proxy': { enabled: true },
}

export function ExtensionConfigForm({ extensionId, config, schema, onChange }: Props) {
  const initial = useMemo(() => ({ ...(BUILTIN_DEFAULTS[extensionId] || {}), ...config }), [extensionId, config])
  const [draft, setDraft] = useState<Record<string, unknown>>(initial)
  const adapterName = schema?.adapter?.displayName || extensionId
  const desktopSupport = schema?.adapter?.desktopSupport

  const update = (key: string, value: unknown) => {
    const next = { ...draft, [key]: value }
    setDraft(next)
    onChange(next)
  }

  return (
    <div className="space-y-4">
      {desktopSupport && (
        <div className="rounded-lg border border-border/50 bg-muted/30 p-3 text-[12px] text-muted-foreground">
          <div className="font-medium text-foreground/80">{adapterName}</div>
          <div className="mt-0.5">{desktopSupport}</div>
        </div>
      )}

      <div className="space-y-2">
        <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground/60">配置项</div>
        {Object.keys(initial).length === 0 && (
          <div className="text-[12px] text-muted-foreground/50 italic">该扩展暂无可配置项（运行时按默认行为）。</div>
        )}
        {Object.entries(initial).map(([key, value]) => (
          <div key={key} className="flex items-center justify-between gap-3">
            <div>
              <div className="text-[12px] font-medium font-mono">{key}</div>
            </div>
            {typeof value === 'boolean' ? (
              <button
                onClick={() => update(key, !draft[key])}
                className={`relative h-5 w-9 rounded-full transition-colors ${draft[key] ? 'bg-primary' : 'bg-muted-foreground/20'}`}
              >
                <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-background transition-transform ${draft[key] ? 'translate-x-4' : 'translate-x-0.5'}`} />
              </button>
            ) : typeof value === 'number' ? (
              <input
                type="number"
                value={Number(draft[key] ?? 0)}
                onChange={(e) => update(key, Number(e.target.value))}
                className="w-20 rounded-md border border-border bg-background px-2 py-1 text-[12px]"
              />
            ) : (
              <input
                value={String(draft[key] ?? '')}
                onChange={(e) => update(key, e.target.value)}
                className="w-40 rounded-md border border-border bg-background px-2 py-1 text-[12px]"
              />
            )}
          </div>
        ))}
      </div>

      <div className="border-t border-border/40 pt-3 text-[10px] text-muted-foreground/50">
        存储于 App 本地（workspaceId + extensionId），不写 pi settings.json。
      </div>
    </div>
  )
}