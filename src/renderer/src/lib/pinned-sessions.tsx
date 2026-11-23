import { ipcClient } from '@renderer/lib/ipc-client'
import { sessionFilesEqual } from '@renderer/lib/session-file-key'
import { useUIStore } from '@renderer/stores/ui-store'

export function isSessionPinned(
  pinnedSessions: readonly string[] | undefined,
  sessionFile: string | null | undefined,
): boolean {
  if (!sessionFile || !pinnedSessions?.length) return false
  return pinnedSessions.some((item) => sessionFilesEqual(item, sessionFile))
}

export function toggleSessionPinned(sessionFile: string | null | undefined): boolean {
  if (!sessionFile) return false
  const pinnedNow = useUIStore.getState().togglePinSession(sessionFile)
  const nextList = useUIStore.getState().pinnedSessions
  void ipcClient.invoke('settings.set', { key: 'pinnedSessions', value: nextList }).catch(() => {})
  return pinnedNow
}

export function SessionPinGlyph({ className = 'h-3 w-3' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
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
