import { useTranslation } from 'react-i18next'
import { AlertTriangle, Check, Loader2, XCircle } from '@renderer/components/icons'
import { cn } from '@renderer/lib/utils'
import type { SshProbeResult } from './ssh-types'

export function SshProbeBadge({ probe, probing }: { probe?: SshProbeResult | null; probing?: boolean }) {
  const { t } = useTranslation('ssh')
  if (probing) {
    return (
      <span className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-2xs text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" /> {t('probing')}
      </span>
    )
  }
  if (!probe) return null
  return (
    <span className={cn(
      'inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-2xs font-medium',
      probe.ok ? 'bg-green-500/15 text-green-600 dark:text-green-400' : 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
    )}>
      {probe.ok ? <Check className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}
      {t(probe.ok ? 'ready' : 'needsAttention')}
    </span>
  )
}

function ProbeRow({ ok, warn, label, detail }: { ok: boolean; warn?: boolean; label: string; detail: string }) {
  const Icon = ok ? Check : warn ? AlertTriangle : XCircle
  const color = ok ? 'text-green-600 dark:text-green-400' : warn ? 'text-amber-500' : 'text-destructive'
  return (
    <div className="flex items-center gap-2 text-xs">
      <Icon className={cn('h-3.5 w-3.5 shrink-0', color)} />
      <span className="font-medium text-foreground">{label}</span>
      <span className="truncate font-mono text-[11px] text-muted-foreground">{detail}</span>
    </div>
  )
}

export function SshProbeChecklist({ probe }: { probe: SshProbeResult }) {
  const { t } = useTranslation('ssh')
  return (
    <div className="mt-2 space-y-1 rounded-md border border-border/40 bg-[var(--bg-1)]/40 p-2.5">
      <ProbeRow ok={probe.node} label="Node.js" detail={probe.node ? `${probe.nodeVersion ?? ''} · ${probe.nodePath ?? ''}` : t('notInstalled')} />
      <ProbeRow ok={probe.sdk} label="pi SDK" detail={probe.sdk ? `${probe.sdkVersion ?? ''} · ${probe.sdkPath ?? ''}` : t('sdkInstall')} />
      <ProbeRow ok={probe.git} warn={!probe.git} label="Git" detail={t(probe.git ? 'ready' : 'notFound')} />
      <ProbeRow ok={!!probe.home} label="Shell / HOME" detail={`${probe.shell ?? '/bin/sh'} · ${probe.home ?? ''}`} />
      {!probe.home && probe.error ? <p className="pt-1 text-xs text-destructive">{t('connectFailed')}</p> : null}
    </div>
  )
}
