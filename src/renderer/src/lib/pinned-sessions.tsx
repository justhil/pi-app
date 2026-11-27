import { ipcClient } from '@renderer/lib/ipc-client'
import { normalizeSessionFileKey, sessionFilesEqual } from '@renderer/lib/session-file-key'
import { useUIStore } from '@renderer/stores/ui-store'
import type { PinnedSessionRecord } from '@renderer/stores/ui-store-types'

export type { PinnedSessionRecord }

export function pinnedSessionKey(sessionFile: string | null | undefined): string {
  if (!sessionFile) return ''
  return normalizeSessionFileKey(sessionFile) || sessionFile.trim().replace(/\\/g, '/').toLowerCase()
}

export function isSessionPinned(
  pinnedSessions: readonly string[] | undefined,
  sessionFile: string | null | undefined,
): boolean {
  if (!sessionFile || !pinnedSessions?.length) return false
  return pinnedSessions.some((item) => sessionFilesEqual(item, sessionFile))
}

function persistPinnedToSettings(): void {
  const { pinnedSessions, pinnedSessionMeta } = useUIStore.getState()
  void ipcClient.invoke('settings.set', { key: 'pinnedSessions', value: pinnedSessions }).catch(() => {})
  void ipcClient.invoke('settings.set', { key: 'pinnedSessionMeta', value: pinnedSessionMeta }).catch(() => {})
}

export interface TogglePinInput {
  sessionFile: string
  sessionId?: string
  workspacePath?: string
  title?: string
  kind?: 'project' | 'sandbox'
}

/**
 * Toggle pin state for a session and persist both its path list and full metadata snapshot
 * (so pinned sessions NEVER vanish after restart or switching to another project).
 */
export function toggleSessionPinned(input: string | TogglePinInput | null | undefined): boolean {
  if (!input) return false
  const meta: TogglePinInput = typeof input === 'string' ? { sessionFile: input } : input
  if (!meta.sessionFile?.trim()) return false
  const pinnedNow = useUIStore.getState().togglePinSession(meta.sessionFile, {
    sessionId: meta.sessionId || '',
    workspacePath: meta.workspacePath || '',
    title: meta.title || '',
    kind: meta.kind || 'project',
  })
  persistPinnedToSettings()
  return pinnedNow
}

export function updatePinnedSessionSnapshot(
  sessionFile: string | null | undefined,
  patch: Partial<Omit<PinnedSessionRecord, 'sessionFile'>>,
): void {
  if (!sessionFile) return
  const st = useUIStore.getState()
  if (!isSessionPinned(st.pinnedSessions, sessionFile)) return
  st.upsertPinnedSessionMeta(sessionFile, patch)
  persistPinnedToSettings()
}

export function removePinnedSession(sessionFile: string | null | undefined): void {
  if (!sessionFile) return
  const st = useUIStore.getState()
  if (!isSessionPinned(st.pinnedSessions, sessionFile)) return
  st.togglePinSession(sessionFile)
  persistPinnedToSettings()
}

export function SessionPinGlyph({
  className = 'h-3 w-3',
  filled = false,
}: {
  className?: string
  filled?: boolean
}) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d="M9.8 2.4 13.6 6.2 12.2 7.6 10.6 7 7.6 10 8.2 11.6 6.8 13 4.6 10.8 2 14l3.2-2.6L3 9.2 4.4 7.8 6 8.4 9 5.4 8.4 3.8Z" />
    </svg>
  )
}
