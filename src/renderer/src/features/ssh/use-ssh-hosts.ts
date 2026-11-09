import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { errorMessage } from '@shared/error-message'
import { ipcClient } from '@renderer/lib/ipc-client'
import { activateWorkspace } from '@renderer/lib/activate-workspace'
import type { RemoteDirListing, SshHostFormValues, SshHostItem, SshProbeResult, SshRuntime } from './ssh-types'

interface HostResponse {
  ok?: boolean
  hosts?: SshHostItem[]
  error?: string
  runtime?: SshRuntime
  workspacePath?: string
}

function useSshInspection() {
  const { t } = useTranslation('ssh')
  const [probes, setProbes] = useState<Record<string, SshProbeResult>>({})
  const [probingHost, setProbingHost] = useState<string | null>(null)
  const [dirListings, setDirListings] = useState<Record<string, RemoteDirListing>>({})
  const [loadingDirHost, setLoadingDirHost] = useState<string | null>(null)

  const probe = async (host: string, refresh: boolean) => {
    setProbingHost(host)
    try {
      const { result } = await ipcClient.invoke('ssh.probeHost', { host, refresh }) as { result: SshProbeResult }
      setProbes((prev) => ({ ...prev, [host]: result }))
    } catch (error) {
      toast.error(errorMessage(error) || t('probeFailed'))
    } finally {
      setProbingHost(null)
    }
  }

  const browse = async (host: string, path?: string) => {
    setLoadingDirHost(host)
    try {
      const listing = await ipcClient.invoke('ssh.listRemoteDir', { host, path }) as RemoteDirListing
      setDirListings((prev) => ({ ...prev, [host]: listing }))
    } catch (error) {
      toast.error(errorMessage(error) || t('directoryFailed'))
    } finally {
      setLoadingDirHost(null)
    }
  }
  return { probes, probingHost, dirListings, loadingDirHost, probe, browse }
}

async function changeHosts(
  method: 'ssh.saveHost' | 'ssh.removeHost',
  payload: Record<string, unknown>,
  setHosts: (hosts: SshHostItem[]) => void,
  failure: string,
): Promise<boolean> {
  try {
    const result = await ipcClient.invoke(method, payload) as HostResponse
    if (!result.ok || !result.hosts) throw new Error(result.error || failure)
    setHosts(result.hosts)
    return true
  } catch (error) {
    toast.error(errorMessage(error) || failure)
    return false
  }
}

function useSshHostEdits(setHosts: (hosts: SshHostItem[]) => void) {
  const { t } = useTranslation('ssh')
  const [saving, setSaving] = useState(false)
  const save = (payload: Record<string, unknown>) => changeHosts('ssh.saveHost', payload, setHosts, t('saveFailed'))

  const add = async (form: SshHostFormValues) => {
    setSaving(true)
    try {
      const saved = await save({
        host: form.host.trim(),
        label: form.label.trim() || undefined,
        port: form.port ? Number(form.port) : undefined,
        identityFile: form.identityFile.trim() || undefined,
        remotePath: form.remotePath.trim() || '~',
      })
      if (saved) toast.success(t('hostSaved'))
      return saved
    } finally {
      setSaving(false)
    }
  }
  const savePath = (host: string, remotePath: string) => save({ host, remotePath })
  const remove = (host: string) => changeHosts('ssh.removeHost', { host }, setHosts, t('removeFailed'))
  return { saving, add, savePath, remove }
}

function useSshConnection(
  setHosts: (hosts: SshHostItem[]) => void,
  probe: (host: string, refresh: boolean) => Promise<void>,
  onRuntimeSynced?: (runtime: SshRuntime) => void,
) {
  const { t } = useTranslation('ssh')
  const [connecting, setConnecting] = useState(false)
  const connect = async (item: SshHostItem, enabled: boolean, remotePath?: string) => {
    setConnecting(true)
    try {
      const result = await ipcClient.invoke('ssh.connect', {
        host: item.host,
        enabled,
        remotePath: remotePath || item.remotePath || '~',
      }) as HostResponse
      if (!result.ok) {
        toast.error(t(result.error === 'AGENT_RUNTIME_BUSY' ? 'runtimeBusy' : 'connectFailed'))
        return
      }
      if (result.hosts) setHosts(result.hosts)
      if (result.runtime) onRuntimeSynced?.(result.runtime)
      if (enabled) {
        toast.success(t('connected', { host: item.label || item.host }))
        void probe(item.host, false)
        if (result.workspacePath) await activateWorkspace(result.workspacePath)
      } else {
        toast.success(t('disconnected'))
      }
    } catch (error) {
      toast.error(errorMessage(error) || t('switchFailed'))
    } finally {
      setConnecting(false)
    }
  }
  return { connecting, connect }
}

export function useSshHosts(onRuntimeSynced?: (runtime: SshRuntime) => void) {
  const { t } = useTranslation('ssh')
  const [hosts, setHosts] = useState<SshHostItem[]>([])
  const inspection = useSshInspection()
  const { saving, add, savePath, remove } = useSshHostEdits(setHosts)
  const { connecting, connect } = useSshConnection(setHosts, inspection.probe, onRuntimeSynced)
  const refresh = useCallback(async () => {
    try {
      const response = await ipcClient.invoke('ssh.listHosts', {}) as HostResponse
      if (!Array.isArray(response.hosts)) throw new Error(t('loadFailed'))
      setHosts(response.hosts)
    } catch (error) {
      toast.error(errorMessage(error) || t('loadFailed'))
    }
  }, [t])
  useEffect(() => { void refresh() }, [refresh])
  return { hosts, busy: saving || connecting, refresh, add, savePath, remove, connect, ...inspection }
}
