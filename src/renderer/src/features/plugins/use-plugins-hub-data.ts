import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { resolveAdapterText, type AdapterJson } from '@extension-compat/adapter-schema'
import { invalidateAdapterSnapshots, useAdapterCatalog } from '@renderer/lib/adapter-catalog'
import { openSettingsToPage } from '@renderer/lib/agent-purge-store'
import { ipcClient } from '@renderer/lib/ipc-client'
import { useUIStore } from '@renderer/stores/ui-store'
import {
  isAdaptedPluginInstalled,
  type InstalledExtensionItem,
} from '@renderer/features/settings/adapted-extensions-installer'
import { describeTransport } from '@renderer/features/settings/mcp-form'

export type PluginCategory = 'all' | 'mcp' | 'skills' | 'extensions'

export interface UnifiedPluginRow {
  uid: string
  category: Exclude<PluginCategory, 'all'>
  iconKind: 'mcp' | 'skill' | 'extension'
  skillIcon?: string
  title: string
  badge: string
  subtitle: string
  enabled: boolean
  canToggle: boolean
  busy: boolean
  statusDot?: 'ok' | 'warn' | 'err'
  onToggle?: (next: boolean) => void
  onConfigure: () => void
}

export interface CuratedPluginCard {
  id: string
  title: string
  description: string
  metaLine: string
  installed: boolean
  installing: boolean
  configurable: boolean
  onInstall: () => void
  onConfigure: () => void
}

interface RawSkill {
  key: string
  name: string
  description?: string
  enabled: boolean
  command?: string
  alias?: string
  icon?: string
}

interface RawExt extends InstalledExtensionItem {
  description?: string
  piSync?: boolean
  piEnabled?: boolean
  enabled?: boolean
}

interface RawMcpRow {
  name: string
  scope: 'global' | 'project'
  config: Record<string, unknown>
  override?: Record<string, unknown>
}

interface RawMcpStatus {
  name: string
  state: string
}

function adapterHasConfig(adapter?: AdapterJson): boolean {
  const c = adapter?.config
  if (!c) return false
  return Boolean(c.customRenderer || (c.sections && c.sections.length > 0) || c.configFile || c.piSettingsKey)
}

function mapMcpDot(state?: string): 'ok' | 'warn' | 'err' | undefined {
  if (state === 'connected') return 'ok'
  if (state === 'needs-auth' || state === 'connecting') return 'warn'
  if (state === 'failed' || state === 'disconnected') return 'err'
  return undefined
}

function mapMcpRows(
  rows: RawMcpRow[],
  statusMap: Record<string, RawMcpStatus>,
  busyIds: Set<string>,
  t: (k: string) => string,
  onToggle: (row: RawMcpRow, next: boolean) => void,
): UnifiedPluginRow[] {
  return rows.map((row) => {
    const uid = `mcp:${row.name}`
    const enabled = row.config.enabled !== false
    const isRemote = typeof row.config.url === 'string'
    const kindDesc = isRemote ? t('common:pluginsHub.remoteMcpServer') : t('common:pluginsHub.localMcpServer')
    const detail = describeTransport(row.config)
    return {
      uid,
      category: 'mcp',
      iconKind: 'mcp',
      title: row.name,
      badge: t('common:pluginsHub.badgeMcp'),
      subtitle: detail ? `${kindDesc} · ${detail}` : kindDesc,
      enabled,
      canToggle: true,
      busy: busyIds.has(uid),
      statusDot: enabled ? mapMcpDot(statusMap[row.name]?.state) : undefined,
      onToggle: (next) => onToggle(row, next),
      onConfigure: () => openSettingsToPage('mcp'),
    }
  })
}

function mapExtensionRows(
  extensions: RawExt[],
  adapterMap: Map<string, AdapterJson>,
  lang: string,
  busyIds: Set<string>,
  t: (k: string) => string,
  onToggle: (ext: RawExt, next: boolean) => void,
  onConfigAdapter: (id: string) => void,
): UnifiedPluginRow[] {
  return extensions.map((ext) => {
    const uid = `ext:${ext.id}`
    const adapter = ext.adapterId ? adapterMap.get(ext.adapterId) : undefined
    const localized = adapter ? resolveAdapterText(adapter, lang) : null
    return {
      uid,
      category: 'extensions',
      iconKind: 'extension',
      title: localized?.displayName || ext.name || ext.id,
      badge: t('common:pluginsHub.badgeExtension'),
      subtitle: localized?.description || ext.description || ext.packageName || ext.id,
      enabled: Boolean(ext.piEnabled ?? ext.enabled ?? true),
      canToggle: Boolean(ext.piSync),
      busy: busyIds.has(uid),
      onToggle: ext.piSync ? (next) => onToggle(ext, next) : undefined,
      onConfigure: () => {
        if (adapter && adapterHasConfig(adapter)) onConfigAdapter(adapter.id)
        else openSettingsToPage('extensions')
      },
    }
  })
}

function mapSkillRows(
  skills: RawSkill[],
  pres: Record<string, { alias?: string; icon?: string }>,
  busyIds: Set<string>,
  t: (k: string) => string,
  onToggle: (sk: RawSkill, next: boolean) => void,
): UnifiedPluginRow[] {
  return skills.map((sk) => {
    const uid = `skill:${sk.key}`
    const meta = pres[sk.key]
    return {
      uid,
      category: 'skills',
      iconKind: 'skill',
      skillIcon: meta?.icon || sk.icon,
      title: meta?.alias?.trim() || sk.alias?.trim() || sk.name,
      badge: t('common:pluginsHub.badgeSkill'),
      subtitle: sk.description || sk.command || sk.name,
      enabled: sk.enabled,
      canToggle: true,
      busy: busyIds.has(uid),
      onToggle: (next) => onToggle(sk, next),
      onConfigure: () => openSettingsToPage('skills'),
    }
  })
}

function mapCuratedCards(
  adapters: readonly AdapterJson[],
  extensions: readonly RawExt[],
  lang: string,
  installingId: string | null,
  t: (k: string) => string,
  onInstall: (adapter: AdapterJson, name: string) => void,
  onConfigAdapter: (id: string) => void,
): CuratedPluginCard[] {
  return adapters
    .filter((a) => a.kind !== 'desktop' && a.tier !== 'none' && Boolean(a.install?.source?.trim()))
    .map((adapter) => {
      const text = resolveAdapterText(adapter, lang)
      const title = text.displayName || adapter.displayName || adapter.id
      const configurable = adapterHasConfig(adapter)
      return {
        id: adapter.id,
        title,
        description: text.description || adapter.description || '',
        metaLine: `${t('common:pluginsHub.badgeAdapted')} · ${adapter.install!.source}`,
        installed: isAdaptedPluginInstalled(adapter, extensions),
        installing: installingId === adapter.id,
        configurable,
        onInstall: () => onInstall(adapter, title),
        onConfigure: () => (configurable ? onConfigAdapter(adapter.id) : openSettingsToPage('extensions')),
      }
    })
}

export function usePluginsHubData() {
  const { t, i18n } = useTranslation()
  const workspaceId = useUIStore((s) => s.currentWorkspace) || ''
  const requestExtensionConfig = useUIStore((s) => s.requestExtensionConfig)
  const catalog = useAdapterCatalog(workspaceId)
  const [skills, setSkills] = useState<RawSkill[]>([])
  const [skillPres, setSkillPres] = useState<Record<string, { alias?: string; icon?: string }>>({})
  const [extensions, setExtensions] = useState<RawExt[]>([])
  const [mcpRows, setMcpRows] = useState<RawMcpRow[]>([])
  const [mcpStatus, setMcpStatus] = useState<Record<string, RawMcpStatus>>({})
  const [busyIds, setBusyIds] = useState<Set<string>>(() => new Set())
  const [installingId, setInstallingId] = useState<string | null>(null)

  const setBusy = useCallback((id: string, on: boolean) => {
    setBusyIds((prev) => {
      const next = new Set(prev)
      if (on) next.add(id)
      else next.delete(id)
      return next
    })
  }, [])

  const reloadAll = useCallback(async () => {
    const [presRes, extRes, mcpRes] = await Promise.all([
      ipcClient.invoke('settings.get', { key: 'skillPresentation' }).catch(() => null),
      ipcClient.invoke('extensions.list', { workspaceId }).catch(() => null),
      ipcClient.invoke('mcp.config.get').catch(() => null),
    ])
    setSkillPres((presRes?.settings?.skillPresentation || {}) as Record<string, { alias?: string; icon?: string }>)
    setExtensions((extRes?.extensions || []) as RawExt[])
    const servers = (mcpRes?.ok ? mcpRes.servers || [] : []) as RawMcpRow[]
    setMcpRows(servers)
    void ipcClient.invoke('skills.list').then((skRes) => {
      setSkills((skRes?.skills || skRes?.candidates || []) as RawSkill[])
    }).catch(() => {})
    if (!servers.length) return
    const st = await ipcClient.invoke('mcp.status').catch(() => null)
    if (st?.ok && Array.isArray(st.servers)) {
      setMcpStatus(Object.fromEntries((st.servers as RawMcpStatus[]).map((s) => [s.name, s])))
    }
  }, [workspaceId])

  useEffect(() => { void reloadAll() }, [reloadAll])

  const runMutation = useCallback(async (uid: string, work: () => Promise<{ ok?: boolean; error?: string } | null>) => {
    setBusy(uid, true)
    try {
      const res = await work()
      if (res && res.ok === false) toast.error(String(res.error || t('common:saveFailed')))
      await reloadAll()
    } finally {
      setBusy(uid, false)
    }
  }, [reloadAll, setBusy, t])

  const installCurated = useCallback(async (adapter: AdapterJson, displayName: string) => {
    if (installingId) return
    setInstallingId(adapter.id)
    try {
      const res = await ipcClient.invoke('extensions.install', { adapterId: adapter.id, scope: 'global', ...(workspaceId ? { workspaceId } : {}) })
      if (!res?.ok) { toast.error(`${displayName}: ${res?.error || t('common:operationFailed')}`); return }
      toast.success(t('settings:extensions.installSuccess', { name: displayName }))
      invalidateAdapterSnapshots()
      await reloadAll()
    } finally {
      setInstallingId(null)
    }
  }, [installingId, reloadAll, t, workspaceId])

  const adapterMap = useMemo(() => new Map((catalog?.adapters ?? []).map((a) => [a.id, a])), [catalog?.adapters])

  const installedRows = useMemo(() => [
    ...mapMcpRows(mcpRows, mcpStatus, busyIds, t, (r, v) => void runMutation(`mcp:${r.name}`, () => ipcClient.invoke('mcp.server.patch', { name: r.name, target: r.override ? 'override' : r.scope, enabled: v }))),
    ...mapExtensionRows(extensions, adapterMap, i18n.language, busyIds, t, (e, v) => void runMutation(`ext:${e.id}`, () => ipcClient.invoke('extensions.setEnabled', { extensionId: e.id, enabled: v })), requestExtensionConfig),
    ...mapSkillRows(skills, skillPres, busyIds, t, (s, v) => void runMutation(`skill:${s.key}`, () => ipcClient.invoke('skills.applyOverrides', { changes: [{ key: s.key, enabled: v }] }))),
  ], [adapterMap, busyIds, extensions, i18n.language, mcpRows, mcpStatus, requestExtensionConfig, runMutation, skillPres, skills, t])

  const curatedCards = useMemo(
    () => mapCuratedCards(catalog?.adapters ?? [], extensions, i18n.language, installingId, t, (a, n) => void installCurated(a, n), requestExtensionConfig),
    [catalog?.adapters, extensions, i18n.language, installCurated, installingId, requestExtensionConfig, t],
  )

  return { installedRows, curatedCards }
}
