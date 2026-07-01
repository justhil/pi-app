import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { GripVertical, LayoutPanelLeft } from 'lucide-react'
import { cn } from '@renderer/lib/utils'
import { useSettingsDraft } from '@renderer/features/settings/settings-draft-context'
import type { RightPanelCatalogItem } from '@shared/right-panels'
import { SettingsPageHeader } from '@renderer/features/settings/settings-shell'

function Toggle({ on, onChange, disabled }: { on: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onChange(!on)}
      className={cn(
        'relative h-5 w-9 shrink-0 rounded-full transition-colors duration-motion-fast ease-motion-ease disabled:opacity-40',
        on ? 'bg-primary' : 'bg-muted-foreground/20',
      )}
      aria-pressed={on}
    >
      <div
        className={cn(
          'absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-all duration-motion-fast ease-motion-ease',
          on ? 'left-4' : 'left-0.5',
        )}
      />
    </button>
  )
}

export function RightPanelsSettings() {
  const { t } = useTranslation()
  const {
    draft,
    setRightPanelPref,
    reorderRightPanels,
    resetRightPanelsToDefault,
    refreshRightPanelCatalog,
  } = useSettingsDraft()

  const { rightPanelCatalog: catalog, rightPanelPrefs: prefs, rightPanelOrder: order } = draft
  const [dragId, setDragId] = useState<string | null>(null)
  const [overIndex, setOverIndex] = useState<number | null>(null)

  const orderedItems = useMemo(() => {
    const byId = new Map(catalog.map((c) => [c.id, c]))
    return order.map((id) => byId.get(id)).filter((x): x is RightPanelCatalogItem => !!x)
  }, [catalog, order])

  const enabledCount = order.filter((id) => prefs[id]).length

  const setOne = (id: string, on: boolean) => {
    if (!on && enabledCount <= 1) {
      toast.message('至少保留一个栏目')
      return
    }
    setRightPanelPref(id, on)
  }

  return (
    <div className="space-y-1">
      <SettingsPageHeader
        title="右侧栏"
        description="拖拽排序与开关仅修改草稿，请使用页面底部「保存」写入本机并更新主界面 Tab。"
        action={
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => resetRightPanelsToDefault()}
              className="rounded-md border border-border/50 px-3 py-1.5 text-[12px] text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              恢复默认
            </button>
            <button
              type="button"
              onClick={() => void refreshRightPanelCatalog()}
              className="rounded-md border border-border/50 px-3 py-1.5 text-[12px] text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              刷新目录
            </button>
          </div>
        }
      />

      <div className="mb-4 flex items-center gap-2 rounded-lg border border-border/40 bg-[var(--bg-1)]/50 px-3 py-2 text-[12px] text-muted-foreground">
        <LayoutPanelLeft className="h-4 w-4 shrink-0 opacity-60" />
        <span>
          已启用 {enabledCount} / {order.length} 个栏目 · 拖拽排序
        </span>
      </div>

      <ul
        className="relative space-y-1.5 rounded-lg border border-border/40 p-1.5"
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) setOverIndex(null)
        }}
      >
        {orderedItems.map((item, index) => {
          const label = item.labelKey ? t(item.labelKey, { defaultValue: item.fallbackLabel }) : item.fallbackLabel
          const on = !!prefs[item.id]
          const lastOne = on && enabledCount <= 1
          const isDragging = dragId === item.id
          const showLineBefore = overIndex === index && dragId !== item.id

          return (
            <li key={item.id} className="relative list-none">
              {showLineBefore && (
                <div
                  className="pointer-events-none absolute -top-1 left-2 right-2 z-10 h-0.5 rounded-full bg-primary shadow-[0_0_8px_var(--primary)]"
                  aria-hidden
                />
              )}
              <div
                draggable
                onDragStart={(e) => {
                  setDragId(item.id)
                  e.dataTransfer.effectAllowed = 'move'
                  e.dataTransfer.setData('text/plain', item.id)
                }}
                onDragEnd={() => {
                  setDragId(null)
                  setOverIndex(null)
                }}
                onDragOver={(e) => {
                  e.preventDefault()
                  e.dataTransfer.dropEffect = 'move'
                  setOverIndex(index)
                }}
                onDrop={(e) => {
                  e.preventDefault()
                  const from = dragId || e.dataTransfer.getData('text/plain')
                  if (!from) return
                  reorderRightPanels(from, index)
                  setDragId(null)
                  setOverIndex(null)
                }}
                className={cn(
                  'group flex items-center gap-2 rounded-lg border border-border/40 bg-card/40 px-2 py-2.5 transition-all duration-motion-normal ease-motion-ease',
                  'hover:border-border/70 hover:bg-accent/30 hover:shadow-sm',
                  isDragging && 'scale-[0.98] border-primary/40 bg-accent/50 opacity-80 shadow-md',
                )}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <div className="text-[13px] font-medium text-foreground">{label}</div>
                    {item.source === 'adapter' && (
                      <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[9px] text-primary">适配器</span>
                    )}
                  </div>
                  <div className="mt-0.5 text-[11px] text-muted-foreground/70">{item.description}</div>
                  <div className="mt-1 font-mono text-[10px] text-muted-foreground/45">
                    {item.id}
                    {item.adapterId ? ` · ${item.adapterId}` : ''}
                  </div>
                </div>

                <Toggle on={on} onChange={(v) => setOne(item.id, v)} disabled={lastOne && on} />
                <div
                  aria-hidden
                  className={cn(
                    'flex h-9 w-8 shrink-0 cursor-grab items-center justify-center rounded-md text-muted-foreground/35',
                    'hover:bg-muted/60 hover:text-muted-foreground active:cursor-grabbing',
                    isDragging && 'cursor-grabbing text-primary',
                  )}
                >
                  <GripVertical className="h-4 w-4" />
                </div>
              </div>
            </li>
          )
        })}
        {overIndex === orderedItems.length && dragId && (
          <li className="relative h-0 list-none">
            <div className="absolute -top-1 left-2 right-2 h-0.5 rounded-full bg-primary shadow-[0_0_8px_var(--primary)]" />
          </li>
        )}
        {orderedItems.length > 0 && (
          <li
            className="h-2 list-none"
            onDragOver={(e) => {
              e.preventDefault()
              setOverIndex(orderedItems.length)
            }}
            onDrop={(e) => {
              e.preventDefault()
              const from = dragId || e.dataTransfer.getData('text/plain')
              if (!from) return
              reorderRightPanels(from, orderedItems.length)
              setDragId(null)
              setOverIndex(null)
            }}
          />
        )}
      </ul>
    </div>
  )
}