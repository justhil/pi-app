// 兼容层：adapter.json sidePanel.stateProvider → 状态函数（无插件名 IPC）

import { findAdapterById } from '../extension-compat/adapter-loader'
import { readAdapterConfig } from '../extension-compat/adapter-backend'
import { readWorkspaceTaskPanelState } from './workspace-task-panel-reader'

export type SidePanelStateProviderId = 'workspace-trellis'

const PROVIDERS: Record<
  SidePanelStateProviderId,
  (cwd: string, adapterId: string, workspaceId: string) => unknown
> = {
  'workspace-trellis': (cwd, adapterId, workspaceId) => {
    const base = readWorkspaceTaskPanelState(cwd)
    const view = readAdapterConfig(adapterId, workspaceId)
    const showRecentJournal = view.showRecentJournal !== false
    const limit = typeof view.journalLimit === 'number' ? view.journalLimit : 5
    if (!showRecentJournal) return { ...base, recentJournals: [] }
    if (base.recentJournals && base.recentJournals.length > limit) {
      return { ...base, recentJournals: base.recentJournals.slice(0, limit) }
    }
    return base
  },
}

export function resolveSidePanelState(
  adapterId: string,
  cwd: string,
  workspaceId: string,
): { ok: true; state: unknown } | { ok: false; error: string } {
  const adapter = findAdapterById(adapterId, cwd)
  const sp = adapter?.sidePanel
  if (!sp?.stateProvider) return { ok: false, error: 'no_state_provider' }
  const fn = PROVIDERS[sp.stateProvider as SidePanelStateProviderId]
  if (!fn) return { ok: false, error: `unknown_provider:${sp.stateProvider}` }
  return { ok: true, state: fn(cwd, adapterId, workspaceId) }
}