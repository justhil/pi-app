import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { GripVertical } from '@renderer/components/icons'
import { cn } from '@renderer/lib/utils'
import { useSettingsDraft } from '@renderer/features/settings/settings-draft-context'
import type { RightPanelCatalogItem } from '@shared/right-panels'
import { SettingsPageHeader } from '@renderer/features/settings/settings-shell'
import { SettingRow, SettingsSection, Toggle } from '@renderer/features/settings/settings-page-shared'
import { btnOutline } from '@renderer/features/settings/settings-controls'
import { BrowserSettingsSection } from '@renderer/features/browser/browser-settings-section'
import { useUIStore } from '@renderer/stores/ui-store'
import { isStageRightPanelId } from '@shared/right-panels'

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
  const railIcons = useUIStore((s) => s.rightPanelRailIcons)
  const setRailIcons = useUIStore((s) => s.setRightPanelRailIcons)
  const [dragId, setDragId] = useState<string | null>(null)
  const [overIndex, setOverIndex] = useState<number | null>(null)

  const orderedItems = useMemo(() => {
    const byId = new Map(catalog.map((c) => [c.id, c]))
    return order.map((id) => byId.get(id)).filter((x): x is RightPanelCatalogItem => !!x)
  }, [catalog, order])

  const enabledCount = order.filter((id) => prefs[id]).length

  const setOne = (id: string, on: boolean) => {
    if (!on && enabledCount <= 1) {
      toast.message(t('settings:rightPanels.keepOne'))
      return
    }
    setRightPanelPref(id, on)
  }

  return (
    <div className="flex flex-col gap-7">
      <SettingsPageHeader
        title={t('settings:nav.rightPanels')}
        description={t('settings:rightPanels.description')}
        action={
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => resetRightPanelsToDefault()}
              className={btnOutline}
            >
              {t('common:resetToDefault')}
            </button>
            <button
              type="button"
              onClick={() => void refreshRightPanelCatalog()}
              className={btnOutline}
            >
              {t('settings:rightPanels.refreshCatalog')}
            </button>
          </div>
        }
      />

      <SettingsSection title={t('settings:rightPanels.behaviorSection')}>
        <SettingRow
          label={t('settings:rightPanels.railIcons')}
          description={t('settings:rightPanels.railIconsDesc')}
        >
          <Toggle on={railIcons} onChange={setRailIcons} />
        </SettingRow>
      </SettingsSection>

      <SettingsSection
        title={t('settings:rightPanels.listSection')}
        description={t('settings:rightPanels.enabledCount', { enabled: enabledCount, total: order.length })}
      >
        <ul
          className="settings-flush relative divide-y divide-[var(--shell-hairline)]"
          onDragLeave={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node)) setOverIndex(null)
          }}
        >
          {orderedItems.map((item, index) => {
            const label = item.labelKey ? t(item.labelKey, { defaultValue: item.fallbackLabel }) : item.fallbackLabel
            const desc = item.descriptionKey ? t(item.descriptionKey, { defaultValue: item.description }) : item.description
            const on = !!prefs[item.id]
            const lastOne = on && enabledCount <= 1
            const isDragging = dragId === item.id
            const showLineBefore = overIndex === index && dragId !== item.id
            const isStage = isStageRightPanelId(item.id)

            return (
              <li key={item.id} className="relative list-none">
                {showLineBefore && (
                  <div
                    className="pointer-events-none absolute -top-px left-3 right-3 z-10 h-0.5 rounded-full bg-[var(--brand)]"
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
                    'group flex items-center gap-3 px-4 py-3 transition-colors duration-motion-fast',
                    'hover:bg-foreground/[0.025]',
                    isDragging && 'bg-foreground/[0.05] opacity-70',
                  )}
                >
                  <div
                    aria-hidden
                    className={cn(
                      'flex h-7 w-6 shrink-0 cursor-grab items-center justify-center rounded-md text-foreground-secondary/40',
                      'hover:bg-foreground/[0.05] hover:text-foreground-secondary active:cursor-grabbing',
                      isDragging && 'cursor-grabbing text-[var(--brand)]',
                    )}
                  >
                    <GripVertical className="h-4 w-4" strokeWidth={1.5} />
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <div className="text-[13.5px] font-medium text-foreground">{label}</div>
                      {isStage ? (
                        <span className="rounded-md bg-[var(--brand)]/10 px-1.5 py-0.5 text-[10.5px] font-medium text-[var(--brand)]">
                          {t('common:panel.stageGroup')}
                        </span>
                      ) : null}
                      {item.source === 'adapter' && (
                        <span className="rounded-md bg-foreground/[0.06] px-1.5 py-0.5 text-[10.5px] text-foreground-secondary">
                          {t('adapters:title')}
                        </span>
                      )}
                    </div>
                    <div className="mt-0.5 text-[12px] text-foreground-secondary/80">{desc}</div>
                    <div className="mt-0.5 font-mono text-[10.5px] text-foreground-secondary/50">
                      {item.id}
                      {item.adapterId ? ` · ${item.adapterId}` : ''}
                    </div>
                  </div>

                  <Toggle on={on} onChange={(v) => setOne(item.id, v)} disabled={lastOne && on} />
                </div>
              </li>
            )
          })}
          {overIndex === orderedItems.length && dragId && (
            <li className="relative h-0 list-none">
              <div className="absolute -top-px left-3 right-3 h-0.5 rounded-full bg-[var(--brand)]" />
            </li>
          )}
          {orderedItems.length > 0 && (
            <li
              className="h-1 list-none"
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
      </SettingsSection>

      {prefs.browser ? <BrowserSettingsSection /> : null}
    </div>
  )
}