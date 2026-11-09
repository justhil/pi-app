import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus, RefreshCw, Terminal } from '@renderer/components/icons'
import { btnOutline } from '@renderer/features/settings/settings-controls'
import { SettingsSection } from '@renderer/features/settings/settings-page-shared'
import { SshHostCard } from './ssh-host-card'
import { SshHostForm } from './ssh-host-form'
import { useSshHosts } from './use-ssh-hosts'
import type { SshHostFormValues, SshRuntime } from './ssh-types'

type SshManagerProps = { onRuntimeSynced?: (runtime: SshRuntime) => void }

function SshToolbar({ onRefresh, onAdd }: { onRefresh: () => void; onAdd: () => void }) {
  const { t } = useTranslation('ssh')
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <span className="text-xs text-muted-foreground">{t('configDescription')}</span>
      <div className="flex items-center gap-1.5">
        <button type="button" className={btnOutline} onClick={onRefresh}>
          <RefreshCw className="h-3 w-3" /> {t('refreshHosts')}
        </button>
        <button type="button" className={btnOutline} onClick={onAdd}>
          <Plus className="h-3 w-3" /> {t('addHost')}
        </button>
      </div>
    </div>
  )
}

function SshHostList({ state }: { state: ReturnType<typeof useSshHosts> }) {
  const { t } = useTranslation('ssh')
  if (state.hosts.length === 0) {
    return (
      <div className="flex flex-col items-center rounded-lg border border-dashed border-border/60 py-6 text-center">
        <Terminal className="h-5 w-5 text-muted-foreground/50" />
        <p className="mt-2 text-sm text-muted-foreground">{t('emptyHosts')}</p>
        <p className="mt-0.5 text-xs text-muted-foreground/60">{t('emptyHint')}</p>
      </div>
    )
  }
  return (
    <div className="space-y-1.5">
      {state.hosts.map((item) => (
        <SshHostCard
          key={item.host}
          item={item}
          busy={state.busy}
          probe={state.probes[item.host]}
          probing={state.probingHost === item.host}
          dirListing={state.dirListings[item.host]}
          loadingDirs={state.loadingDirHost === item.host}
          onToggle={(host, enabled, path) => void state.connect(host, enabled, path)}
          onOpenWorkspace={(host, path) => void state.connect(host, true, path)}
          onProbe={(host, refresh) => void state.probe(host, refresh)}
          onBrowseDir={(host, path) => void state.browse(host, path)}
          onSavePath={(host, path) => void state.savePath(host, path)}
          onRemove={(host) => void state.remove(host)}
        />
      ))}
    </div>
  )
}

export function SshManagerCore({ onRuntimeSynced }: SshManagerProps) {
  const [adding, setAdding] = useState(false)
  const state = useSshHosts(onRuntimeSynced)
  const addHost = async (form: SshHostFormValues) => {
    if (await state.add(form)) setAdding(false)
  }
  return (
    <div className="space-y-2.5">
      <SshToolbar onRefresh={() => void state.refresh()} onAdd={() => setAdding((open) => !open)} />
      {adding ? <SshHostForm busy={state.busy} onAdd={(form) => void addHost(form)} onCancel={() => setAdding(false)} /> : null}
      <SshHostList state={state} />
    </div>
  )
}

export function SshSettingsSection({ onRuntimeSynced }: SshManagerProps) {
  const { t } = useTranslation('ssh')
  return (
    <SettingsSection title={t('title')} description={t('description')}>
      <div className="py-2">
        <SshManagerCore onRuntimeSynced={onRuntimeSynced} />
      </div>
    </SettingsSection>
  )
}

export function SshPanel() {
  const { t } = useTranslation('ssh')
  return (
    <div className="flex h-full flex-col overflow-y-auto p-3">
      <div className="mb-3">
        <h3 className="text-sm font-medium text-foreground">{t('title')}</h3>
        <p className="mt-0.5 text-xs text-muted-foreground">{t('description')}</p>
      </div>
      <SshManagerCore />
    </div>
  )
}
