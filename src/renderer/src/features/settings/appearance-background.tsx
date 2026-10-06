import { Fragment, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Image as ImageIcon, X } from '@renderer/components/icons'
import { Switch } from '@renderer/components/ui/switch'
import { btnCompact, selectCls } from '@renderer/features/settings/settings-controls'
import { useSettingsDraft } from '@renderer/features/settings/settings-draft-context'
import { SettingRow, SettingsSection } from '@renderer/features/settings/settings-page-shared'
import { ipcClient } from '@renderer/lib/ipc-client'
import { backgroundPreviewUrl } from '@renderer/lib/theme/background-layer'
import { BACKGROUND_DEFAULTS, type BackgroundImage, type BackgroundSettings } from '@shared/background'

type Slot = 'light' | 'dark'

function Thumb({ file }: { file: string }) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    void backgroundPreviewUrl(file).then((u) => live && setUrl(u))
    return () => {
      live = false
    }
  }, [file])
  return <div className="h-12 w-20 shrink-0 rounded-md border border-border bg-muted bg-cover bg-center" style={url ? { backgroundImage: `url("${url}")` } : undefined} aria-hidden />
}

function Slider({ label, value, min, max, step, format, onChange }: { label: string; value: number; min: number; max: number; step: number; format: (n: number) => string; onChange: (n: number) => void }) {
  return (
    <div className="flex w-full min-w-[14rem] items-center gap-3 sm:w-64">
      <input type="range" min={min} max={max} step={step} value={value} aria-label={label} className="settings-field-focus min-w-0 flex-1 accent-[var(--brand)]" onChange={(e) => onChange(Number(e.target.value))} />
      <output className="w-10 text-right font-mono text-[12px] text-foreground">{format(value)}</output>
    </div>
  )
}

const pct = (n: number) => `${Math.round(n * 100)}%`

/** Settings → Appearance → Background: an image behind the window, light / dark or shared. */
export function AppearanceBackground() {
  const { t } = useTranslation()
  const { draft, setBackground } = useSettingsDraft()
  const bg = draft.background
  const slots: Slot[] = bg.shared ? ['light'] : ['light', 'dark']

  const update = (next: BackgroundSettings) => setBackground(next)
  const patchSlot = (slot: Slot, patch: Partial<BackgroundImage>) => {
    const cur = bg[slot]
    if (cur) update({ ...bg, [slot]: { ...cur, ...patch } })
  }

  const choose = async (slot: Slot) => {
    const r = (await ipcClient.invoke('background.choose', {})) as { ok: boolean; file?: string; error?: string }
    if (r.ok && r.file) update({ ...bg, [slot]: { ...BACKGROUND_DEFAULTS, ...(bg[slot] ?? {}), file: r.file } })
    else if (r.error && r.error !== 'canceled') toast.error(t(`settings:appearance.bgError.${r.error}`))
  }

  const remove = (slot: Slot) => {
    const next = { ...bg }
    delete next[slot]
    update(next)
  }

  return (
    <SettingsSection title={t('settings:appearance.bgTitle')} description={t('settings:appearance.bgDesc')}>
      <SettingRow label={t('settings:appearance.bgShared')} description={t('settings:appearance.bgSharedDesc')}>
        <Switch aria-label={t('settings:appearance.bgShared')} checked={bg.shared} onCheckedChange={(shared) => update({ ...bg, shared })} />
      </SettingRow>
      {slots.map((slot) => {
        const img = bg[slot]
        const name = bg.shared ? t('settings:appearance.bgImage') : t(`settings:appearance.bgImage${slot === 'light' ? 'Light' : 'Dark'}`)
        return (
          <Fragment key={slot}>
            <SettingRow label={name} description={img ? undefined : t('settings:appearance.bgNone')}>
              <div className="flex items-center gap-2">
                {img ? <Thumb file={img.file} /> : null}
                <button type="button" className={btnCompact} onClick={() => void choose(slot)}>
                  <ImageIcon className="h-3 w-3" strokeWidth={2} aria-hidden="true" />
                  {img ? t('settings:appearance.bgReplace') : t('settings:appearance.bgChoose')}
                </button>
                {img ? (
                  <button type="button" className={btnCompact} onClick={() => remove(slot)} aria-label={`${t('settings:appearance.bgRemove')} (${name})`}>
                    <X className="h-3 w-3" strokeWidth={2} aria-hidden="true" />
                    {t('settings:appearance.bgRemove')}
                  </button>
                ) : null}
              </div>
            </SettingRow>
            {img ? (
              <>
                <SettingRow label={t('settings:appearance.bgOpacity')} description={t('settings:appearance.bgOpacityDesc')}>
                  <Slider label={t('settings:appearance.bgOpacity')} value={img.opacity} min={0.05} max={1} step={0.05} format={pct} onChange={(opacity) => patchSlot(slot, { opacity })} />
                </SettingRow>
                <SettingRow label={t('settings:appearance.bgUiOpacity')} description={t('settings:appearance.bgUiOpacityDesc')}>
                  <Slider label={t('settings:appearance.bgUiOpacity')} value={img.uiOpacity} min={0.5} max={1} step={0.02} format={pct} onChange={(uiOpacity) => patchSlot(slot, { uiOpacity })} />
                </SettingRow>
                <SettingRow label={t('settings:appearance.bgBlur')}>
                  <Slider label={t('settings:appearance.bgBlur')} value={img.blur} min={0} max={24} step={1} format={(n) => `${n}px`} onChange={(blur) => patchSlot(slot, { blur })} />
                </SettingRow>
                <SettingRow label={t('settings:appearance.bgFit')}>
                  <div className="flex flex-wrap items-center gap-2">
                    <select aria-label={t('settings:appearance.bgFit')} value={img.fit} className={selectCls} onChange={(e) => patchSlot(slot, { fit: e.target.value as BackgroundImage['fit'] })}>
                      {(['cover', 'contain', 'tile', 'center'] as const).map((f) => (
                        <option key={f} value={f}>{t(`settings:appearance.bgFitOption.${f}`)}</option>
                      ))}
                    </select>
                    {img.fit === 'cover' ? (
                      <select aria-label={t('settings:appearance.bgPosition')} value={img.position} className={selectCls} onChange={(e) => patchSlot(slot, { position: e.target.value as BackgroundImage['position'] })}>
                        {(['center', 'top', 'bottom'] as const).map((p) => (
                          <option key={p} value={p}>{t(`settings:appearance.bgPositionOption.${p}`)}</option>
                        ))}
                      </select>
                    ) : null}
                  </div>
                </SettingRow>
              </>
            ) : null}
          </Fragment>
        )
      })}
    </SettingsSection>
  )
}
