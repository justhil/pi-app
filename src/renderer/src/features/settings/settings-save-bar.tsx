import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'
import { cn } from '@renderer/lib/utils'
import { takeLastSettingsSaveError, useSettingsDraft } from '@renderer/features/settings/settings-draft-context'
import { SETTINGS_COLUMN, SETTINGS_COLUMN_WIDE } from '@renderer/features/settings/settings-shell'
export function SettingsSaveBar({ wide = false }: { wide?: boolean }) {
  const { t } = useTranslation()
  const { dirty, dirtySliceLabels, saving, discard, save } = useSettingsDraft()

  const onSave = async () => {
    const ok = await save()
    if (ok) {
      toast.success(t('common:settingsSaved'))
      window.dispatchEvent(new Event('pi-desktop:asr-config-saved'))
    }
    else {
      // Known refusals from the main process get their own explanation.
      const message = String((takeLastSettingsSaveError() as Error | null)?.message ?? '')
      toast.error(
        message.includes('AGENT_RUNTIME_BUSY')
          ? t('settings:runtime.switchBusy')
          : message.includes('WSL_ENV_UNAVAILABLE')
            ? t('settings:runtime.switchEnvUnavailable')
            : t('common:saveFailed'),
      )
    }
  }

  return (
    <div
      className={cn(
        'settings-save-bar shrink-0 bg-[var(--bg-base)]/95 px-6 py-2.5 backdrop-blur-sm sm:px-9 lg:px-12',
        'transition-all duration-motion-normal',
        dirty && 'shadow-[0_-4px_20px_-8px_rgba(0,0,0,0.08)]',
      )}
      style={{ borderTop: '1px solid var(--shell-hairline)' }}
    >
      <div className={cn('flex flex-wrap items-center justify-between gap-3', wide ? SETTINGS_COLUMN_WIDE : SETTINGS_COLUMN)}>
        <div className="min-w-0 text-[12.5px] text-foreground-secondary">
          {dirty ? (
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
              <span className="inline-flex items-center gap-1.5 font-medium text-amber-700 dark:text-amber-400">
                <span className="h-1.5 w-1.5 rounded-full bg-amber-500" aria-hidden />
                {t('common:unsavedChanges')}
              </span>
              {dirtySliceLabels.length > 0 && (
                <span className="truncate text-[11.5px] text-foreground-secondary/70">
                  {dirtySliceLabels.join(' · ')}
                </span>
              )}
            </div>
          ) : (
            <span className="text-foreground-secondary/65">{t('common:allChangesSaved')}</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={!dirty || saving}
            onClick={() => void discard().then(() => toast.message(t('common:reverted')))}
            className="rounded-lg border border-border/70 px-3 py-1.5 text-[12.5px] text-foreground-secondary transition-colors hover:bg-foreground/[0.05] hover:text-foreground disabled:pointer-events-none disabled:opacity-35"
          >
            {t('common:discard')}
          </button>
          <button
            type="button"
            disabled={!dirty || saving}
            onClick={() => void onSave()}
            className={cn(
              'rounded-lg px-3.5 py-1.5 text-[12.5px] font-medium transition-all duration-motion-fast',
              dirty
                ? 'bg-primary text-primary-foreground shadow-xs hover:opacity-90'
                : 'bg-foreground/[0.06] text-foreground-secondary/70',
              (!dirty || saving) && 'pointer-events-none opacity-50',
            )}
          >
            {saving ? t('common:saving') : t('common:save')}
          </button>
        </div>
      </div>
    </div>
  )
}
