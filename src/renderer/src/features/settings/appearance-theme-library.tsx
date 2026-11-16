import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import type { CustomCssOverride, CustomTheme } from '@shared/custom-theme'
import type { CssSnippetItem, CssSnippetValues, SavedThemePack } from '@shared/theme-pack'
import { Switch } from '@renderer/components/ui/switch'
import { ipcClient } from '@renderer/lib/ipc-client'
import { injectCssSnippets } from '@renderer/lib/theme/render-fx-engine'
import {
  btnCompact,
  btnOutline,
  btnPrimary,
  inputCls,
  textareaCls,
} from '@renderer/features/settings/settings-controls'
import { SettingsSection } from '@renderer/features/settings/settings-page-shared'
import { cn } from '@renderer/lib/utils'
import {
  ChevronDown,
  ChevronRight,
  CloudDownload,
  Plus,
  Sparkles,
  Trash2,
  Upload,
} from '@renderer/components/icons'

const SNIPPET_TEMPLATE = `/* @settings
- id: --my-bubble-radius
  title: User Bubble Radius
  type: number
  default: 14
  min: 2
  max: 24
  step: 1
  unit: px
- id: --my-composer-glow
  title: Composer Rim Tint
  type: color
  default: #4da3ff
- id: fx-glass-bubbles
  title: Refractive User Bubbles
  type: toggle
  default: false
*/

html.fx-glass-bubbles .timeline-user-bubble {
  border-radius: var(--my-bubble-radius, 14px);
  backdrop-filter: url('#pi-liquid-lens') blur(8px) saturate(165%);
  border: 1px solid color-mix(in srgb, var(--my-composer-glow, var(--brand)) 38%, transparent);
}
`

export function AppearanceThemeLibrary({
  theme,
  customCss,
  onApplyPack,
}: {
  theme: CustomTheme
  customCss: CustomCssOverride
  onApplyPack: (nextTheme: CustomTheme, nextCss?: string) => void
}) {
  const { t } = useTranslation()
  const hasDesktopIpc = typeof window !== 'undefined' && Boolean(window.piDesktop)
  const [packs, setPacks] = useState<SavedThemePack[]>([])
  const [packName, setPackName] = useState('')
  const [snippets, setSnippets] = useState<CssSnippetItem[]>([])
  const [editingId, setEditingId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [newSnipName, setNewSnipName] = useState('')
  const [newSnipCss, setNewSnipCss] = useState('')

  useEffect(() => {
    if (!hasDesktopIpc) return
    void ipcClient
      .invoke('themeLibrary.list', {})
      .then((r) => setPacks(r?.items ?? []))
      .catch(() => {})
    void ipcClient
      .invoke('snippets.list', {})
      .then((r) => {
        const list = r?.items ?? []
        setSnippets(list)
        injectCssSnippets(list)
      })
      .catch(() => {})
  }, [hasDesktopIpc])

  const handleSavePack = async () => {
    if (!hasDesktopIpc) return
    const name = packName.trim() || 'My Theme'
    try {
      const res = await ipcClient.invoke('themeLibrary.save', {
        name,
        theme,
        customCss: customCss.enabled && customCss.css.trim() ? customCss.css : undefined,
      })
      if (res?.item) {
        setPacks((prev) => [res.item, ...prev.filter((p) => p.id !== res.item.id)])
        setPackName('')
        toast.success(t('settings:appearance.packSaved'))
      }
    } catch {
      /* ignore */
    }
  }

  const handleDeletePack = async (id: string) => {
    if (!hasDesktopIpc) return
    await ipcClient.invoke('themeLibrary.delete', { id }).catch(() => {})
    setPacks((prev) => prev.filter((p) => p.id !== id))
  }

  const handleImportPack = async () => {
    if (!hasDesktopIpc) return
    const res = await ipcClient.invoke('themeLibrary.importFile', {}).catch(() => null)
    if (res?.ok && res.item) {
      setPacks((prev) => [res.item!, ...prev.filter((p) => p.id !== res.item!.id)])
      onApplyPack(res.item.theme, res.item.customCss)
      toast.success(t('settings:appearance.packApplied', { name: res.item.name }))
    }
  }

  const handleExportPack = async () => {
    if (!hasDesktopIpc) return
    await ipcClient
      .invoke('themeLibrary.exportFile', {
        name: packName.trim() || 'pi-theme-pack',
        theme,
        customCss: customCss.enabled && customCss.css.trim() ? customCss.css : undefined,
      })
      .catch(() => {})
  }

  const openLiveStudio = () => {
    window.dispatchEvent(
      new CustomEvent('pi-desktop:open-live-theme-studio', {
        detail: { theme },
      }),
    )
  }

  const syncSnippets = (next: CssSnippetItem[]) => {
    setSnippets(next)
    injectCssSnippets(next)
  }

  const handleCreateSnippet = async () => {
    if (!hasDesktopIpc || !newSnipCss.trim()) return
    const res = await ipcClient
      .invoke('snippets.save', {
        name: newSnipName.trim() || 'Custom Snippet',
        css: newSnipCss,
        enabled: true,
      })
      .catch(() => null)
    if (res?.item) {
      syncSnippets([...snippets.filter((s) => s.id !== res.item.id), res.item])
      setCreating(false)
      setNewSnipName('')
      setNewSnipCss('')
    }
  }

  const patchSnippet = async (
    id: string,
    patch: { enabled?: boolean; values?: CssSnippetValues; css?: string; name?: string },
  ) => {
    // Optimistic local update for 60fps slider feel
    const optimistic = snippets.map((s) =>
      s.id === id
        ? {
            ...s,
            ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
            ...(patch.css !== undefined ? { css: patch.css } : {}),
            ...(patch.values ? { values: { ...s.values, ...patch.values } } : {}),
          }
        : s,
    )
    syncSnippets(optimistic)
    if (!hasDesktopIpc) return
    const res = await ipcClient.invoke('snippets.patch', { id, ...patch }).catch(() => null)
    if (res?.item) {
      syncSnippets(optimistic.map((s) => (s.id === id ? res.item! : s)))
    }
  }

  const removeSnippet = async (id: string) => {
    syncSnippets(snippets.filter((s) => s.id !== id))
    if (!hasDesktopIpc) return
    await ipcClient.invoke('snippets.delete', { id }).catch(() => {})
  }

  return (
    <div className="flex flex-col gap-8">
      {/* 1. Theme Library & Live Studio launcher */}
      <SettingsSection
        title={t('settings:appearance.libraryTitle')}
        description={t('settings:appearance.libraryDesc')}
        action={
          <button
            type="button"
            onClick={openLiveStudio}
            className={cn(btnPrimary, 'h-8 px-3 text-[12px] leading-none')}
          >
            <Sparkles className="h-3.5 w-3.5 shrink-0" />
            <span>{t('settings:appearance.openLiveStudio')}</span>
          </button>
        }
      >
        <div className="settings-row flex flex-wrap items-center gap-2">
          <input
            type="text"
            value={packName}
            onChange={(e) => setPackName(e.target.value)}
            placeholder={t('settings:appearance.packNamePlaceholder')}
            className={cn(inputCls, 'min-w-[200px] flex-1')}
          />
          <button
            type="button"
            disabled={!theme.light && !theme.dark}
            onClick={() => void handleSavePack()}
            className={btnOutline}
          >
            {t('settings:appearance.savePack')}
          </button>
          <button type="button" onClick={() => void handleImportPack()} className={btnCompact}>
            <Upload className="h-3.5 w-3.5" />
            {t('settings:appearance.importPack')}
          </button>
          <button
            type="button"
            disabled={!theme.light && !theme.dark}
            onClick={() => void handleExportPack()}
            className={btnCompact}
          >
            <CloudDownload className="h-3.5 w-3.5" />
            {t('settings:appearance.exportPack')}
          </button>
        </div>

        {packs.length === 0 ? (
          <div className="settings-row text-[12px] text-muted-foreground">
            {t('settings:appearance.packEmpty')}
          </div>
        ) : (
          packs.map((pack) => {
            const l = pack.theme.light
            const d = pack.theme.dark
            return (
              <div key={pack.id} className="settings-row flex items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  <div className="flex h-7 w-11 shrink-0 overflow-hidden rounded border border-border">
                    <span
                      className="h-full flex-1"
                      style={{ background: l?.surface ?? '#ffffff' }}
                      title="Light"
                    />
                    <span
                      className="h-full flex-1"
                      style={{ background: d?.surface ?? '#141518' }}
                      title="Dark"
                    />
                    <span
                      className="h-full w-2"
                      style={{ background: d?.accent ?? l?.accent ?? '#4da3ff' }}
                    />
                  </div>
                  <div className="min-w-0">
                    <div className="truncate text-[13px] font-medium text-foreground">{pack.name}</div>
                    <div className="truncate font-mono text-[11px] text-muted-foreground">
                      {[
                        d?.frameStyle || l?.frameStyle,
                        d?.surfaceMaterial || l?.surfaceMaterial,
                        d?.codeTheme || l?.codeTheme,
                      ]
                        .filter(Boolean)
                        .join(' · ') || new Date(pack.updatedAt).toLocaleDateString()}
                    </div>
                  </div>
                </div>

                <div className="flex shrink-0 items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => {
                      onApplyPack(pack.theme, pack.customCss)
                      toast.success(t('settings:appearance.packApplied', { name: pack.name }))
                    }}
                    className={btnCompact}
                  >
                    {t('settings:appearance.applyPack')}
                  </button>
                  <button
                    type="button"
                    aria-label={t('settings:appearance.deletePack')}
                    onClick={() => void handleDeletePack(pack.id)}
                    className="inline-flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            )
          })
        )}
      </SettingsSection>

      {/* 2. Modular CSS Snippets with automatic @settings controls */}
      <SettingsSection
        title={t('settings:appearance.snippetsTitle')}
        description={t('settings:appearance.snippetsDesc')}
        action={
          <button
            type="button"
            onClick={() => setCreating((v) => !v)}
            className={btnCompact}
          >
            <Plus className="h-3.5 w-3.5" />
            {t('settings:appearance.newSnippet')}
          </button>
        }
      >
        {creating ? (
          <div className="flex flex-col gap-2.5 px-4 py-3.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <input
                type="text"
                value={newSnipName}
                onChange={(e) => setNewSnipName(e.target.value)}
                placeholder={t('settings:appearance.snippetNamePlaceholder')}
                className={cn(inputCls, 'w-64')}
              />
              <button
                type="button"
                onClick={() => {
                  if (!newSnipName.trim()) setNewSnipName('Liquid Glass Tweaks')
                  setNewSnipCss(SNIPPET_TEMPLATE)
                }}
                className={btnCompact}
              >
                {t('settings:appearance.insertTemplate')}
              </button>
            </div>
            <textarea
              rows={8}
              spellCheck={false}
              value={newSnipCss}
              onChange={(e) => setNewSnipCss(e.target.value)}
              placeholder="/* @settings ... */\n.composer-shell { ... }"
              className={cn(textareaCls, 'font-mono text-[12px]')}
            />
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setCreating(false)} className={btnCompact}>
                {t('settings:appearance.cancel')}
              </button>
              <button
                type="button"
                disabled={!newSnipCss.trim()}
                onClick={() => void handleCreateSnippet()}
                className={btnPrimary}
              >
                {t('settings:appearance.saveSnippet')}
              </button>
            </div>
          </div>
        ) : null}

        {snippets.length === 0 && !creating ? (
          <div className="settings-row text-[12px] text-muted-foreground">
            {t('settings:appearance.snippetsEmpty')}
          </div>
        ) : (
          snippets.map((snip) => {
            const expanded = editingId === snip.id
            return (
              <div key={snip.id} className="settings-row flex flex-col gap-2.5">
                <div className="flex items-center justify-between gap-3">
                  <button
                    type="button"
                    onClick={() => setEditingId(expanded ? null : snip.id)}
                    className="flex min-w-0 flex-1 items-center gap-2 text-left"
                  >
                    {expanded ? (
                      <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    ) : (
                      <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    )}
                    <span className="truncate text-[13px] font-medium text-foreground">{snip.name}</span>
                    {snip.controls.length > 0 ? (
                      <span className="rounded border border-border px-1.5 py-0 font-mono text-[10.5px] text-muted-foreground">
                        @settings · {snip.controls.length}
                      </span>
                    ) : null}
                  </button>

                  <div className="flex items-center gap-2">
                    <Switch
                      checked={snip.enabled}
                      onCheckedChange={(enabled) => void patchSnippet(snip.id, { enabled })}
                    />
                    <button
                      type="button"
                      onClick={() => void removeSnippet(snip.id)}
                      className="inline-flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>

                {/* Auto-generated Style Settings controls when enabled */}
                {snip.enabled && snip.controls.length > 0 ? (
                  <div className="ml-5 flex flex-col gap-2 rounded-lg border border-border/60 bg-[var(--bg-elevated)]/30 px-3.5 py-2.5">
                    {snip.controls.map((ctrl) => {
                      const val = snip.values[ctrl.id] ?? ctrl.default
                      if (ctrl.type === 'toggle') {
                        return (
                          <div key={ctrl.id} className="flex items-center justify-between gap-3 text-[12px]">
                            <span className="text-foreground-secondary">{ctrl.title}</span>
                            <Switch
                              checked={Boolean(val)}
                              onCheckedChange={(v) => void patchSnippet(snip.id, { values: { [ctrl.id]: v } })}
                            />
                          </div>
                        )
                      }
                      if (ctrl.type === 'color') {
                        const hex = typeof val === 'string' ? val : ctrl.default
                        return (
                          <div key={ctrl.id} className="flex items-center justify-between gap-3 text-[12px]">
                            <span className="text-foreground-secondary">{ctrl.title}</span>
                            <input
                              type="color"
                              value={hex.slice(0, 7)}
                              onChange={(e) => void patchSnippet(snip.id, { values: { [ctrl.id]: e.target.value } })}
                              className="h-7 w-10 cursor-pointer rounded border border-border bg-background p-0.5"
                            />
                          </div>
                        )
                      }
                      const num = typeof val === 'number' ? val : ctrl.default
                      return (
                        <div key={ctrl.id} className="flex items-center justify-between gap-3 text-[12px]">
                          <span className="text-foreground-secondary">{ctrl.title}</span>
                          <div className="flex items-center gap-2">
                            <input
                              type="range"
                              min={ctrl.min}
                              max={ctrl.max}
                              step={ctrl.step}
                              value={num}
                              onChange={(e) =>
                                void patchSnippet(snip.id, { values: { [ctrl.id]: Number(e.target.value) } })
                              }
                              className="w-36 accent-[var(--brand)]"
                            />
                            <span className="w-12 text-right font-mono text-[11px] tabular-nums text-foreground">
                              {num}
                              {ctrl.unit ?? ''}
                            </span>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                ) : null}

                {expanded ? (
                  <div className="ml-5">
                    <textarea
                      rows={7}
                      spellCheck={false}
                      value={snip.css}
                      onChange={(e) => void patchSnippet(snip.id, { css: e.target.value })}
                      className={cn(textareaCls, 'font-mono text-[11.5px]')}
                    />
                  </div>
                ) : null}
              </div>
            )
          })
        )}
      </SettingsSection>
    </div>
  )
}
