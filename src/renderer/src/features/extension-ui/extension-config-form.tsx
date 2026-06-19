// Schema-aware config form driven by plugin-adapter-meta configKeys (R0-3).
// No fake defaults: if an adapter declares no configKeys, the subpage shows an
// explanatory note instead of fabricated fields.

import { useMemo, useState } from 'react'
import { SkillsManagerConfig } from './skills-manager-config'
import { McpDiagnostics } from './mcp-diagnostics'

interface Props {
  extensionId: string
  config: Record<string, unknown>
  /** adapter entry from adapters.catalog (carries configKeys / configNote) */
  adapter?: { displayName?: string; desktopSupport?: string; configKeys?: any[]; configNote?: string } | null
  onChange: (next: Record<string, unknown>) => void
}

export function ExtensionConfigForm({ extensionId, config, adapter, onChange }: Props) {
  const adapterName = adapter?.displayName || extensionId
  const desktopSupport = adapter?.desktopSupport
  const configKeys = adapter?.configKeys || []

  const initial = useMemo(() => {
    const base: Record<string, unknown> = {}
    for (const k of configKeys) if (k.default !== undefined) base[k.key] = k.default
    return { ...base, ...config }
  }, [configKeys, config])
  const [draft, setDraft] = useState<Record<string, unknown>>(initial)

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

      {extensionId === '@vanillagreen/pi-skills-manager' ? (
        <SkillsManagerConfig extensionId={extensionId} onChange={onChange} />
      ) : extensionId === 'pi-mcp-adapter' || extensionId.includes('mcp-adapter') ? (
        <McpDiagnostics />
      ) : configKeys.length > 0 ? (
        <div className="space-y-2">
          <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground/60">配置项</div>
          {configKeys.map((k: any) => (
            <ConfigRow key={k.key} def={k} value={draft[k.key]} onChange={(v) => update(k.key, v)} />
          ))}
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-border/60 bg-muted/20 p-4">
          <div className="text-[12px] font-medium text-foreground/80">该扩展自管配置</div>
          <div className="mt-1 text-[12px] text-muted-foreground/70">
            {adapter?.configNote || '此扩展的配置由其自身管理（终端/TUI 或扩展自有配置文件）。桌面不提供等价配置项，以免写入与扩展不一致的假设置。'}
          </div>
        </div>
      )}

      <div className="border-t border-border/40 pt-3 text-[10px] text-muted-foreground/50">
        存储于 App 本地（workspaceId + extensionId），不写 pi settings.json。
      </div>
    </div>
  )
}

function ConfigRow({ def, value, onChange }: { def: any; value: unknown; onChange: (v: unknown) => void }) {
  const label = def.label || def.key
  if (def.readOnly) {
    return (
      <div className="flex items-center justify-between gap-3 py-1">
        <div>
          <div className="text-[12px] font-medium font-mono">{def.key}</div>
          {def.description && <div className="text-[10px] text-muted-foreground/60">{def.description}</div>}
        </div>
        <span className="font-mono text-[11px] text-muted-foreground">{String(value ?? def.default ?? '')}</span>
      </div>
    )
  }
  return (
    <div className="flex items-center justify-between gap-3 py-1">
      <div className="min-w-0">
        <div className="text-[12px] font-medium font-mono">{label}</div>
        {def.description && <div className="text-[10px] text-muted-foreground/60">{def.description}</div>}
      </div>
      {def.type === 'boolean' ? (
        <button
          onClick={() => onChange(!value)}
          className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${value ? 'bg-primary' : 'bg-muted-foreground/20'}`}
        >
          <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-background transition-transform ${value ? 'translate-x-4' : 'translate-x-0.5'}`} />
        </button>
      ) : def.type === 'number' ? (
        <input
          type="number"
          value={Number(value ?? 0)}
          onChange={(e) => onChange(Number(e.target.value))}
          className="w-24 rounded-md border border-border bg-background px-2 py-1 text-[12px]"
        />
      ) : (
        <input
          value={String(value ?? '')}
          onChange={(e) => onChange(e.target.value)}
          className="w-40 rounded-md border border-border bg-background px-2 py-1 text-[12px]"
        />
      )}
    </div>
  )
}