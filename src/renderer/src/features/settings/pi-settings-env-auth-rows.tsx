import { useTranslation } from 'react-i18next'
import { Check, AlertCircle } from 'lucide-react'
import { Row, type PiInfo, type PiSettingsSnapshot } from './pi-settings-shared'

export function PiSettingsEnvAuthRows({ info, ui }: { info: PiInfo | null; ui: PiSettingsSnapshot }) {
  const { t } = useTranslation()
  return (
    <>
      <Row label={t('settings:pi.agentDir')} description={t('settings:pi.agentDirDesc')}>
        <span className="max-w-[220px] truncate font-mono text-[11px] text-muted-foreground" title={info?.agentDir}>
          {info?.agentDir || '~/.pi/agent'}
        </span>
      </Row>
      <Row label={t('settings:pi.auth')} description={t('settings:pi.authDesc')}>
        <div className="flex items-center gap-1.5">
          {info?.authStatus === 'configured' ? (
            <>
              <Check className="h-3.5 w-3.5 text-green-500" />
              <span className="text-[12px] text-green-600 dark:text-green-400">{t('settings:pi.authConfigured')}</span>
            </>
          ) : (
            <>
              <AlertCircle className="h-3.5 w-3.5 text-muted-foreground/40" />
              <span className="text-[12px] text-muted-foreground">{t('settings:pi.authNotConfigured')}</span>
            </>
          )}
        </div>
      </Row>
      {info && (info.authProviders?.length ?? 0) > 0 && (
        <Row label={t('settings:pi.provider')} description={t('settings:pi.providerDesc')}>
          <div className="flex max-w-xs flex-wrap justify-end gap-1">
            {(info.authProviders as Array<{ provider?: string }>).map((p) => (
              <span key={p.provider} className="rounded border border-border/50 px-1.5 py-0.5 font-mono text-[10px]">
                {p.provider}
              </span>
            ))}
          </div>
        </Row>
      )}
      <Row label={t('settings:pi.sessionDir')} description={t('settings:pi.sessionDirDesc')}>
        <span className="max-w-[220px] truncate font-mono text-[11px] text-muted-foreground">
          {String(ui?.sessionDir || t('settings:pi.sessionDirDefault'))}
        </span>
      </Row>
    </>
  )
}