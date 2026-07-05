import { useTranslation } from 'react-i18next'
import { cn } from '@renderer/lib/utils'
import { btnOutline, btnPrimary, selectCls, type PiInfo, type SdkStatus } from './pi-settings-shared'

export function PiSettingsSdkSection({
  info,
  sdkStatus,
  registry,
  envTarget,
  setEnvTarget,
  selectedVersion,
  setSelectedVersion,
  installing,
  switching,
  installOutput,
  onSwitchEnv,
  onInstall,
}: {
  info: PiInfo | null
  sdkStatus: SdkStatus | null
  registry: { versions: string[]; latest: string | null } | null
  envTarget: 'builtin' | 'global' | 'user'
  setEnvTarget: (v: 'builtin' | 'global' | 'user') => void
  selectedVersion: string
  setSelectedVersion: (v: string) => void
  installing: boolean
  switching: boolean
  installOutput: string[]
  onSwitchEnv: (target: 'builtin' | 'global' | 'user') => void
  onInstall: () => void
}) {
  const { t } = useTranslation()
  return (
    <div className="py-3 border-b border-border/40">
      <div className="mb-2 text-[13px] font-medium text-foreground">{t('settings:pi.sdkManagement')}</div>
      <div className="grid grid-cols-1 gap-1.5 text-[12px]">
        <div className="flex justify-between gap-2">
          <span className="text-muted-foreground">{t('settings:pi.builtinVersion')}</span>
          <span className="font-mono text-muted-foreground">{sdkStatus?.builtinVersion || info?.sdkVersion || '—'}</span>
        </div>
        <div className="flex justify-between gap-2">
          <span className="text-muted-foreground">{t('settings:pi.globalVersion')}</span>
          <span className="font-mono text-muted-foreground">{sdkStatus?.globalVersion || t('settings:pi.notDetected')}</span>
        </div>
        <div className="flex justify-between gap-2">
          <span className="text-muted-foreground">{t('settings:pi.userVersion')}</span>
          <span className="font-mono text-muted-foreground">{sdkStatus?.userVersion || t('settings:pi.notInstalled')}</span>
        </div>
        <div className="flex justify-between gap-2">
          <span className="text-muted-foreground">{t('settings:pi.activeVersion')}</span>
          <span className="font-mono text-foreground">
            {sdkStatus?.active?.version || '—'} (
            {sdkStatus?.active?.kind === 'global'
              ? t('settings:pi.kindGlobal')
              : sdkStatus?.active?.kind === 'user'
                ? t('settings:pi.kindUser')
                : t('settings:pi.kindBuiltin')}
            )
          </span>
        </div>
        <div className="flex justify-between gap-2">
          <span className="text-muted-foreground">{t('settings:pi.registryLatest')}</span>
          <span className="font-mono text-muted-foreground">
            {registry?.latest || (registry ? '—' : t('settings:pi.loadingShort'))}
          </span>
        </div>
        <div className="flex justify-between gap-2">
          <span className="text-muted-foreground">npm</span>
          <span className="font-mono text-muted-foreground">
            {sdkStatus?.npmAvailable ? t('settings:pi.npmAvailable') : t('settings:pi.npmNotDetected')}
          </span>
        </div>
      </div>
      {sdkStatus?.active?.fallbackReason && (
        <div className="mt-2 text-[11px] text-amber-600 dark:text-amber-400">
          {sdkStatus.active.kind === 'user' ? t('settings:pi.fallbackUser') : t('settings:pi.fallbackGlobal')}
        </div>
      )}
      {sdkStatus?.workerFallback && (
        <div className="mt-2 text-[11px] text-amber-600 dark:text-amber-400">{t('settings:pi.fallbackWorker')}</div>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className="text-[11px] text-muted-foreground/70">{t('settings:pi.switchEnv')}</span>
        <select
          className={cn(selectCls, 'min-w-[8rem]')}
          value={envTarget}
          disabled={switching || installing}
          onChange={(e) => setEnvTarget(e.target.value as 'builtin' | 'global' | 'user')}
        >
          <option value="builtin">{t('settings:pi.switchEnvBuiltin')}</option>
          <option value="global" disabled={!sdkStatus?.globalVersion}>
            {t('settings:pi.switchEnvGlobal')}
            {!sdkStatus?.globalVersion ? t('settings:pi.switchEnvGlobalNotDetected') : ''}
          </option>
          <option value="user" disabled={!sdkStatus?.userVersion}>
            {t('settings:pi.switchEnvUser')}
            {!sdkStatus?.userVersion ? t('settings:pi.switchEnvUserNotInstalled') : ''}
          </option>
        </select>
        <button
          type="button"
          className={btnOutline}
          disabled={
            switching ||
            installing ||
            envTarget === sdkStatus?.active?.kind ||
            (envTarget === 'global' && !sdkStatus?.globalVersion) ||
            (envTarget === 'user' && !sdkStatus?.userVersion)
          }
          onClick={() => onSwitchEnv(envTarget)}
        >
          {switching ? t('settings:pi.switching') : t('settings:pi.switch')}
        </button>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <span className="text-[11px] text-muted-foreground/70">{t('settings:pi.upgradeEnv')}</span>
        <select
          className={cn(selectCls, 'min-w-[8rem]')}
          value={selectedVersion}
          disabled={installing || !sdkStatus?.npmAvailable}
          onChange={(e) => setSelectedVersion(e.target.value)}
        >
          <option value="">{t('settings:pi.selectVersion')}</option>
          {(registry?.versions || [])
            .slice()
            .reverse()
            .map((v) => (
              <option key={v} value={v}>
                {v}
                {v === registry?.latest ? ` ${t('settings:pi.latest')}` : ''}
              </option>
            ))}
        </select>
        <button
          type="button"
          className={btnPrimary}
          disabled={installing || !selectedVersion || !sdkStatus?.npmAvailable}
          onClick={onInstall}
        >
          {installing ? t('settings:pi.installing') : t('settings:pi.upgradeSwitch')}
        </button>
      </div>
      {(installing || installOutput.length > 0) && (
        <pre className="mt-2 max-h-40 overflow-auto rounded bg-muted/50 p-2 text-[10px] font-mono whitespace-pre-wrap text-muted-foreground">
          {installOutput.join('\n')}
          {installing ? '\n…' : ''}
        </pre>
      )}
    </div>
  )
}