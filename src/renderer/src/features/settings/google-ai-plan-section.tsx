import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'
import {
  AlertCircle,
  CloudDownload,
  Copy,
  ExternalLink,
  KeyRound,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Trash2,
  X,
} from '@renderer/components/icons'
import { ConfirmDialog } from '@renderer/features/settings/confirm-dialog'
import { ipcClient, onAppEvent } from '@renderer/lib/ipc-client'
import { invalidateAvailableModels, prefetchAvailableModels } from '@renderer/lib/available-models-cache'
import type { GoogleAiPlanStatus } from '@shared/ipc-contract'
import { cn } from '@renderer/lib/utils'
import { btnOutline, btnPrimary, inputCls } from './settings-controls'

interface GoogleAiPlanSectionProps {
  onChanged?: () => void | Promise<void>
}

export function GoogleAiPlanSection({ onChanged }: GoogleAiPlanSectionProps) {
  const { t } = useTranslation('settings')
  const [status, setStatus] = useState<GoogleAiPlanStatus | null>(null)
  const [busyAction, setBusyAction] = useState<'sync' | 'login' | 'submit' | 'logout' | 'remove' | null>(null)
  const [manualUrl, setManualUrl] = useState('')
  const [errorText, setErrorText] = useState<string | null>(null)
  const [confirmRemove, setConfirmRemove] = useState(false)
  const prevLoginActiveRef = useRef(false)
  const onChangedRef = useRef(onChanged)
  onChangedRef.current = onChanged
  const tRef = useRef(t)
  tRef.current = t

  const refreshStatus = useCallback(async () => {
    const next = await ipcClient.invoke('googleAiPlan.status', {}).catch(() => null)
    if (!next) return
    const wasActive = prevLoginActiveRef.current
    prevLoginActiveRef.current = Boolean(next.login?.active)
    setStatus(next)
    if (wasActive && !next.login?.active && next.login?.phase === 'succeeded' && next.signedIn) {
      setManualUrl('')
      setErrorText(null)
      invalidateAvailableModels()
      prefetchAvailableModels()
      toast.success(tRef.current('models.googleAiPlanSignedInToast'))
      void onChangedRef.current?.()
    } else if (next.login?.phase === 'failed' && next.login.error) {
      setErrorText(next.login.error)
    }
  }, [])

  useEffect(() => {
    void refreshStatus()
    return onAppEvent((event) => {
      if (event.type === 'sdk-runtime-changed') {
        void refreshStatus()
      }
    })
  }, [refreshStatus])

  const applyResponse = useCallback(
    (res: { ok: boolean; status?: GoogleAiPlanStatus; error?: string } | null | undefined, successToast?: string) => {
      if (res?.status) {
        prevLoginActiveRef.current = Boolean(res.status.login?.active)
        setStatus(res.status)
      }
      if (!res?.ok) {
        const msg = res?.error || t('models.saveFailed')
        setErrorText(msg)
        toast.error(msg)
        return false
      }
      setErrorText(null)
      invalidateAvailableModels()
      prefetchAvailableModels()
      if (successToast) toast.success(successToast)
      void onChangedRef.current?.()
      return true
    },
    [t],
  )

  const handleSync = async () => {
    setBusyAction('sync')
    setErrorText(null)
    try {
      const res = await ipcClient.invoke('googleAiPlan.syncExtension', {})
      applyResponse(res, t('models.googleAiPlanSyncedToast'))
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setErrorText(msg)
      toast.error(msg)
    } finally {
      setBusyAction(null)
    }
  }

  const handleStartLogin = async () => {
    setBusyAction('login')
    setErrorText(null)
    try {
      const res = await ipcClient.invoke('googleAiPlan.loginStart', { autoSync: true })
      applyResponse(res)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setErrorText(msg)
      toast.error(msg)
    } finally {
      setBusyAction(null)
    }
  }

  const handleSubmitManualUrl = async () => {
    const trimmed = manualUrl.trim()
    if (!trimmed) return
    setBusyAction('submit')
    setErrorText(null)
    try {
      const res = await ipcClient.invoke('googleAiPlan.loginSubmitUrl', { callbackUrl: trimmed })
      if (applyResponse(res, t('models.googleAiPlanSignedInToast'))) {
        setManualUrl('')
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setErrorText(msg)
      toast.error(msg)
    } finally {
      setBusyAction(null)
    }
  }

  const handleCancelLogin = async () => {
    setErrorText(null)
    const res = await ipcClient.invoke('googleAiPlan.loginCancel', {}).catch(() => null)
    if (res?.status) {
      prevLoginActiveRef.current = false
      setStatus(res.status)
    }
  }

  const handleLogout = async () => {
    setBusyAction('logout')
    setErrorText(null)
    try {
      const res = await ipcClient.invoke('googleAiPlan.logout', {})
      applyResponse(res, t('models.googleAiPlanSignedOutToast'))
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setErrorText(msg)
      toast.error(msg)
    } finally {
      setBusyAction(null)
    }
  }

  const handleRemove = async () => {
    setConfirmRemove(false)
    setBusyAction('remove')
    setErrorText(null)
    try {
      const res = await ipcClient.invoke('googleAiPlan.removeExtension', {})
      applyResponse(res, t('models.googleAiPlanRemovedToast'))
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setErrorText(msg)
      toast.error(msg)
    } finally {
      setBusyAction(null)
    }
  }

  const openExternal = (url: string) => {
    void ipcClient.invoke('shell.openExternal', { url }).catch(() => {})
  }

  const copyAuthUrl = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url)
      toast.success(t('models.googleAiPlanCopiedToast'))
    } catch {
      /* ignore clipboard error */
    }
  }

  const loginActive = Boolean(status?.login?.active)
  const disabled = busyAction !== null || Boolean(status?.wslUnsupported)
  const shortSha = status?.installedSha ? status.installedSha.slice(0, 7) : null

  const badge = status?.signedIn
    ? {
        dot: 'bg-emerald-500/90',
        label: t('models.googleAiPlanBadgeSignedIn'),
        tone: 'border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
      }
    : status?.builtinInSdk
      ? {
          dot: 'bg-sky-500/90',
          label: t('models.googleAiPlanBadgeBuiltin'),
          tone: 'border-sky-500/25 bg-sky-500/10 text-sky-700 dark:text-sky-300',
        }
      : status?.installed
        ? {
            dot: 'bg-amber-500/90',
            label: t('models.googleAiPlanBadgeInstalled'),
            tone: 'border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300',
          }
        : {
            dot: 'bg-foreground/30',
            label: t('models.googleAiPlanBadgePreview'),
            tone: 'border-border/70 bg-muted/40 text-foreground-secondary',
          }

  return (
    <section className="settings-section" data-testid="google-ai-plan-section">
      <div className="mb-2.5 flex flex-wrap items-end justify-between gap-2 px-1">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-[13.5px] font-semibold leading-5 text-foreground">
              {t('models.googleAiPlanTitle')}
            </h3>
            <span
              data-testid="google-ai-plan-status-badge"
              className={cn(
                'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-medium leading-4',
                badge.tone,
              )}
            >
              <span className={cn('h-1.5 w-1.5 rounded-full', badge.dot)} />
              {badge.label}
            </span>
          </div>
          <p className="mt-0.5 text-[12.5px] leading-[1.6] text-foreground-secondary">
            {t('models.googleAiPlanSubtitle')}
          </p>
        </div>

        <button
          type="button"
          className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-md px-2 py-1 text-[12px] text-foreground-secondary transition-colors hover:bg-[var(--bg-hover)] hover:text-foreground"
          onClick={() => openExternal(status?.prUrl || 'https://github.com/earendil-works/pi/pull/12614')}
        >
          <span>{t('models.googleAiPlanPrLink')}</span>
          <ExternalLink className="h-3 w-3" strokeWidth={2} />
        </button>
      </div>

      <div className="settings-card divide-y divide-border/50">
        <div className="flex flex-wrap items-start justify-between gap-3 px-4 py-3">
          <div className="min-w-0 flex-1 space-y-2">
            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[12px]">
              <span className="inline-flex items-center gap-1 font-mono text-[12.5px] font-medium text-foreground">
                <Sparkles className="h-3.5 w-3.5 text-primary" strokeWidth={2} />
                google-ai-plan
              </span>
              <span className="text-foreground-secondary">·</span>
              <span className="text-foreground-secondary">
                {status?.builtinInSdk
                  ? t('models.googleAiPlanMetaBuiltin')
                  : !status?.installed
                    ? t('models.googleAiPlanMetaNotInstalled')
                    : status.managedByApp && shortSha
                      ? t('models.googleAiPlanMetaSynced', { sha: shortSha })
                      : t('models.googleAiPlanMetaManual')}
              </span>
              <span className="text-foreground-secondary">·</span>
              <span
                className={cn(
                  'inline-flex items-center gap-1',
                  status?.signedIn ? 'text-emerald-700 dark:text-emerald-300' : 'text-foreground-secondary',
                )}
              >
                {status?.signedIn ? (
                  <>
                    <ShieldCheck className="h-3.5 w-3.5" strokeWidth={2} />
                    {t('models.googleAiPlanMetaAuthSignedIn')}
                  </>
                ) : (
                  t('models.googleAiPlanMetaAuthSignedOut')
                )}
              </span>
            </div>

            {status?.models && status.models.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {status.models.map((m) => (
                  <span
                    key={m.id}
                    className="rounded border border-border/60 bg-background/60 px-1.5 py-0.5 font-mono text-[11px] text-foreground-secondary"
                    title={m.name}
                  >
                    {m.id}
                  </span>
                ))}
              </div>
            ) : null}

            {status?.extensionDir && (!status.builtinInSdk || status.installed) ? (
              <p className="truncate font-mono text-[11px] text-muted-foreground/80" title={status.extensionDir}>
                {t('models.googleAiPlanPathHint', { path: status.extensionDir })}
              </p>
            ) : null}
          </div>

          <div className="flex shrink-0 flex-wrap items-center gap-1.5">
            {!status?.signedIn ? (
              <button
                type="button"
                data-testid="google-ai-plan-login-btn"
                disabled={disabled || loginActive}
                className={cn(btnPrimary, 'inline-flex items-center gap-1.5 whitespace-nowrap')}
                onClick={() => void handleStartLogin()}
              >
                {busyAction === 'login' || loginActive ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} />
                ) : (
                  <KeyRound className="h-3.5 w-3.5" strokeWidth={2} />
                )}
                <span>
                  {busyAction === 'login' || loginActive
                    ? t('models.googleAiPlanSignInBusy')
                    : t('models.googleAiPlanSignInBtn')}
                </span>
              </button>
            ) : (
              <button
                type="button"
                data-testid="google-ai-plan-logout-btn"
                disabled={disabled}
                className={cn(btnOutline, 'inline-flex items-center gap-1.5 whitespace-nowrap')}
                onClick={() => void handleLogout()}
              >
                {busyAction === 'logout' ? <Loader2 className="h-3 w-3 animate-spin" strokeWidth={2} /> : null}
                <span>{t('models.googleAiPlanSignOutBtn')}</span>
              </button>
            )}

            {!status?.builtinInSdk ? (
              <button
                type="button"
                data-testid="google-ai-plan-sync-btn"
                disabled={disabled || loginActive}
                className={cn(btnOutline, 'inline-flex items-center gap-1.5 whitespace-nowrap')}
                onClick={() => void handleSync()}
              >
                {busyAction === 'sync' ? (
                  <Loader2 className="h-3 w-3 animate-spin" strokeWidth={2} />
                ) : status?.installed ? (
                  <RefreshCw className="h-3 w-3" strokeWidth={2} />
                ) : (
                  <CloudDownload className="h-3 w-3" strokeWidth={2} />
                )}
                <span>
                  {busyAction === 'sync'
                    ? t('models.googleAiPlanSyncing')
                    : status?.installed
                      ? t('models.googleAiPlanUpdateBtn')
                      : t('models.googleAiPlanSyncBtn')}
                </span>
              </button>
            ) : null}

            {status?.installed ? (
              <button
                type="button"
                data-testid="google-ai-plan-remove-btn"
                disabled={disabled || loginActive}
                title={t('models.googleAiPlanRemoveBtn')}
                className={cn(
                  btnOutline,
                  'inline-flex items-center gap-1 whitespace-nowrap hover:border-destructive/40 hover:text-destructive',
                )}
                onClick={() => setConfirmRemove(true)}
              >
                <Trash2 className="h-3 w-3" strokeWidth={2} />
                <span>{t('models.googleAiPlanRemoveBtn')}</span>
              </button>
            ) : null}
          </div>
        </div>

        {loginActive ? (
          <div className="space-y-2.5 bg-muted/20 px-4 py-3" data-testid="google-ai-plan-login-drawer">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-[12.5px] text-foreground">
                <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-primary" strokeWidth={2} />
                <span>
                  {status?.login.phase === 'exchanging'
                    ? t('models.googleAiPlanExchanging')
                    : t('models.googleAiPlanWaitingAuth')}
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                {status?.login.authUrl ? (
                  <>
                    <button
                      type="button"
                      className={cn(btnOutline, 'inline-flex items-center gap-1 whitespace-nowrap text-[11.5px]')}
                      onClick={() => openExternal(status.login.authUrl!)}
                    >
                      <ExternalLink className="h-3 w-3" strokeWidth={2} />
                      {t('models.googleAiPlanReopenAuthBtn')}
                    </button>
                    <button
                      type="button"
                      className={cn(btnOutline, 'inline-flex items-center gap-1 whitespace-nowrap text-[11.5px]')}
                      onClick={() => void copyAuthUrl(status.login.authUrl!)}
                    >
                      <Copy className="h-3 w-3" strokeWidth={2} />
                      {t('models.googleAiPlanCopyUrlBtn')}
                    </button>
                  </>
                ) : null}
                <button
                  type="button"
                  data-testid="google-ai-plan-cancel-btn"
                  className={cn(btnOutline, 'inline-flex items-center gap-1 whitespace-nowrap text-[11.5px]')}
                  onClick={() => void handleCancelLogin()}
                >
                  <X className="h-3 w-3" strokeWidth={2} />
                  {t('models.googleAiPlanCancelBtn')}
                </button>
              </div>
            </div>

            <div className="space-y-1">
              <p className="text-[11.5px] text-foreground-secondary">{t('models.googleAiPlanManualHint')}</p>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  data-testid="google-ai-plan-manual-input"
                  value={manualUrl}
                  onChange={(e) => setManualUrl(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void handleSubmitManualUrl()
                  }}
                  placeholder={t('models.googleAiPlanManualPlaceholder')}
                  className={cn(inputCls, 'flex-1 font-mono text-[11.5px]')}
                />
                <button
                  type="button"
                  data-testid="google-ai-plan-manual-submit"
                  disabled={!manualUrl.trim() || busyAction === 'submit'}
                  className={cn(btnOutline, 'shrink-0 whitespace-nowrap')}
                  onClick={() => void handleSubmitManualUrl()}
                >
                  {t('models.googleAiPlanManualSubmit')}
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {status?.wslUnsupported ? (
          <div className="flex items-start gap-2 px-4 py-2.5 text-[12px] text-foreground-secondary">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" strokeWidth={2} />
            <span>{t('models.googleAiPlanWslHint')}</span>
          </div>
        ) : null}

        {status?.builtinInSdk && status.autoRemovedForBuiltinSdk ? (
          <div
            data-testid="google-ai-plan-auto-removed-hint"
            className="flex items-start gap-2 px-4 py-2.5 text-[12px] text-foreground-secondary"
          >
            <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500" strokeWidth={2} />
            <span>{t('models.googleAiPlanAutoRemovedHint')}</span>
          </div>
        ) : status?.builtinInSdk && status.installed ? (
          <div className="flex items-start gap-2 px-4 py-2.5 text-[12px] text-foreground-secondary">
            <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-sky-500" strokeWidth={2} />
            <span>{t('models.googleAiPlanBuiltinHint')}</span>
          </div>
        ) : null}

        {errorText ? (
          <div
            data-testid="google-ai-plan-error"
            className="flex items-start gap-2 bg-destructive/5 px-4 py-2.5 text-[12px] text-destructive"
          >
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={2} />
            <span className="min-w-0 break-words">{errorText}</span>
          </div>
        ) : null}
      </div>

      <ConfirmDialog
        open={confirmRemove}
        destructive
        title={t('models.googleAiPlanRemoveConfirmTitle')}
        message={t('models.googleAiPlanRemoveConfirmMessage')}
        confirmLabel={t('models.googleAiPlanRemoveBtn')}
        onConfirm={() => void handleRemove()}
        onCancel={() => setConfirmRemove(false)}
      />
    </section>
  )
}
