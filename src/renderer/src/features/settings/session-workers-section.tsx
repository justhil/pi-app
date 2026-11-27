import { useTranslation } from 'react-i18next'
import { cn } from '@renderer/lib/utils'
import { useSettingsDraft } from './settings-draft-context'
import { numberInputCls } from './settings-controls'
import { SettingRow, SettingsSection } from './settings-page-shared'

const WORKER_PRESETS = [4, 8, 12, 16] as const

export function SessionWorkersSection() {
  const { t } = useTranslation()
  const {
    draft,
    setMaxSessionWorkers,
    setSessionWorkerIdleTimeoutMinutes,
  } = useSettingsDraft()

  if (!draft) return null

  return (
    <SettingsSection
      title={t('settings:general.workersAdvanced')}
      description={t('settings:general.workersAdvancedDesc')}
    >
      <SettingRow
        label={t('settings:general.maxSessionWorkers')}
        description={t('settings:general.maxSessionWorkersDesc')}
        settingKey="maxSessionWorkers"
      >
        <div className="flex flex-wrap items-center justify-end gap-1.5">
          {WORKER_PRESETS.map((preset) => {
            const active = draft.maxSessionWorkers === preset
            return (
              <button
                key={preset}
                type="button"
                aria-pressed={active}
                onClick={() => setMaxSessionWorkers(preset)}
                className={cn(
                  'settings-chip rounded-md border px-2 py-1 font-mono text-xs tabular-nums transition-all duration-motion-fast ease-motion-ease',
                  active
                    ? 'border-primary/40 bg-primary/10 font-medium text-foreground'
                    : 'border-border/50 text-muted-foreground hover:bg-accent hover:text-foreground',
                )}
              >
                {preset}
              </button>
            )
          })}
          <input
            type="number"
            min={1}
            max={64}
            step={1}
            aria-label={t('settings:general.maxSessionWorkers')}
            value={draft.maxSessionWorkers}
            onChange={(e) => {
              const n = Number(e.target.value)
              if (!Number.isFinite(n)) return
              setMaxSessionWorkers(n)
            }}
            className={numberInputCls}
          />
        </div>
      </SettingRow>
      <SettingRow
        label={t('settings:general.sessionWorkerIdleTimeout')}
        description={t('settings:general.sessionWorkerIdleTimeoutDesc')}
        settingKey="sessionWorkerIdleTimeoutMinutes"
      >
        <input
          type="number"
          min={0}
          step={1}
          aria-label={t('settings:general.sessionWorkerIdleTimeout')}
          value={draft.sessionWorkerIdleTimeoutMinutes}
          onChange={(e) => {
            const n = Number(e.target.value)
            if (!Number.isFinite(n)) return
            setSessionWorkerIdleTimeoutMinutes(n)
          }}
          className={numberInputCls}
        />
      </SettingRow>
    </SettingsSection>
  )
}
