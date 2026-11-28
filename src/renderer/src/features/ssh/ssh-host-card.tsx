import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, Folder, FolderOpen, Loader2, RefreshCw, Trash2 } from '@renderer/components/icons'
import { cn } from '@renderer/lib/utils'
import { Toggle } from '@renderer/features/settings/settings-page-shared'
import { btnCompact, btnOutline, inputCls } from '@renderer/features/settings/settings-controls'
import { SshProbeBadge, SshProbeChecklist } from './ssh-environment'
import { SshFolderPicker } from './ssh-folder-picker'
import type { RemoteDirListing, SshHostItem, SshProbeResult } from './ssh-types'

interface SshHostCardProps {
  item: SshHostItem
  busy: boolean
  probe?: SshProbeResult | null
  probing?: boolean
  dirListing?: RemoteDirListing | null
  loadingDirs?: boolean
  onToggle: (item: SshHostItem, enabled: boolean, remotePath?: string) => void
  onOpenWorkspace: (item: SshHostItem, remotePath: string) => void
  onProbe: (host: string, refresh: boolean) => void
  onBrowseDir: (host: string, path?: string) => void
  onSavePath: (host: string, remotePath: string) => void
  onRemove?: (host: string) => void
}

function useSshHostCard({ item, onToggle, onBrowseDir, onSavePath }: SshHostCardProps) {
  const [expanded, setExpanded] = useState(item.enabled)
  const [path, setPath] = useState(item.remotePath || '~')
  const [showBrowser, setShowBrowser] = useState(false)
  const toggle = (enabled: boolean) => {
    if (enabled) setExpanded(true)
    onToggle(item, enabled, path)
  }
  const browse = () => {
    setShowBrowser((visible) => !visible)
    onBrowseDir(item.host, path || '~')
  }
  const select = (chosen: string) => {
    setPath(chosen)
    setShowBrowser(false)
    onSavePath(item.host, chosen)
  }
  return {
    open: expanded || item.enabled, path, setPath, showBrowser, toggle, browse, select,
    expand: () => setExpanded((value) => !value),
  }
}

type CardState = ReturnType<typeof useSshHostCard>
type CardView = { props: SshHostCardProps; state: CardState }

function formatTarget(item: SshHostItem): string {
  const host = item.user && item.hostName ? `${item.user}@${item.hostName}` : item.hostName || item.host
  return item.port && item.port !== 22 ? `${host}:${item.port}` : host
}

function HostIdentity({ props, state }: CardView) {
  const { t } = useTranslation('ssh')
  const { item } = props
  return (
    <div className="min-w-0 flex-1">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-base font-medium text-foreground">{item.label || item.host}</span>
        <span className="rounded bg-primary/10 px-1.5 py-0.5 text-2xs text-primary">{t(`source.${item.source}`)}</span>
        {item.enabled ? (
          <span className="rounded bg-green-500/15 px-1.5 py-0.5 text-2xs font-medium text-green-600 dark:text-green-400">
            {t('active')}
          </span>
        ) : null}
        <SshProbeBadge probe={props.probe} probing={props.probing} />
      </div>
      <div className="mt-0.5 text-xs text-muted-foreground/75">
        {formatTarget(item)} · {t('remoteDirectory')} <span className="font-mono">{state.path || '~'}</span>
      </div>
      <div className="mt-1 font-mono text-2xs text-muted-foreground/50">ssh@{item.host}</div>
    </div>
  )
}

function HostHeader({ props, state }: CardView) {
  return (
    <div className="flex items-center gap-2">
      <button type="button" onClick={state.expand} className="flex min-w-0 flex-1 items-start gap-2 text-left">
        <ChevronDown className={cn('mt-1 h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform', !state.open && '-rotate-90')} />
        <HostIdentity props={props} state={state} />
      </button>
      <Toggle on={props.item.enabled} disabled={props.busy} onChange={state.toggle} />
    </div>
  )
}

function HostActions({ props, state }: CardView) {
  const { t } = useTranslation('ssh')
  const { item, busy, loadingDirs, probing } = props
  const actions = [
    { key: 'browse', icon: loadingDirs ? Loader2 : Folder, loading: loadingDirs, disabled: loadingDirs, run: state.browse },
    { key: 'openWorkspace', icon: FolderOpen, loading: false, disabled: busy, run: () => props.onOpenWorkspace(item, state.path || '~') },
    { key: 'probe', icon: probing ? Loader2 : RefreshCw, loading: probing, disabled: probing, run: () => props.onProbe(item.host, true) },
  ] as const
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <input
        type="text"
        value={state.path}
        onChange={(event) => state.setPath(event.target.value)}
        onBlur={() => props.onSavePath(item.host, state.path)}
        aria-label={t('remoteDirectory')}
        placeholder={t('directoryPlaceholder')}
        className={cn(inputCls, 'h-8 min-w-[180px] flex-1 font-mono text-xs')}
      />
      {actions.map(({ key, icon: Icon, disabled, run, loading }) => (
        <button key={key} type="button" className={cn(btnOutline, 'h-8 px-2.5 text-xs')} disabled={disabled} onClick={run}>
          <Icon className={cn('h-3 w-3', loading && 'animate-spin')} /> {t(key)}
        </button>
      ))}
      {item.source === 'custom' && props.onRemove ? (
        <button type="button" className={cn(btnCompact, 'h-8 text-destructive')} disabled={busy}
          onClick={() => props.onRemove?.(item.host)} title={t('removeHost')}>
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      ) : null}
    </div>
  )
}

function HostDetails({ props, state }: CardView) {
  return (
    <div className="mt-3 border-t border-border/40 pt-2.5">
      <HostActions props={props} state={state} />
      {state.showBrowser && props.dirListing ? (
        <SshFolderPicker
          listing={props.dirListing}
          loading={props.loadingDirs}
          onNavigate={(path) => props.onBrowseDir(props.item.host, path)}
          onSelect={state.select}
        />
      ) : null}
      {props.probe ? <SshProbeChecklist probe={props.probe} /> : null}
    </div>
  )
}

export function SshHostCard(props: SshHostCardProps) {
  const state = useSshHostCard(props)
  return (
    <div className={cn(
      'rounded-lg border border-border/40 bg-card/40 px-3 py-2.5 transition-all',
      props.item.enabled && 'border-primary/40 bg-primary/[0.03]',
    )}>
      <HostHeader props={props} state={state} />
      {state.open ? <HostDetails props={props} state={state} /> : null}
    </div>
  )
}
