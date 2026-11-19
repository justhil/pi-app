import { create } from 'zustand'
import type { ExtensionStatusEvent } from '@shared/app-events'
import type { StatusBarPillSnapshot } from '@shared/background-tasks'
import { normalizeSessionFileKey } from '@renderer/lib/session-file-key'

interface AdapterStatusBarStoreState {
  pillsBySession: Record<string, StatusBarPillSnapshot[]>
}

export const useAdapterStatusBarStore = create<AdapterStatusBarStoreState>(() => ({
  pillsBySession: {},
}))

function bucketKey(sessionFile: string | null | undefined): string {
  return normalizeSessionFileKey(sessionFile) || sessionFile?.trim() || 'default'
}

export function applyExtensionStatusEvent(
  sessionFile: string | undefined,
  event: ExtensionStatusEvent,
): void {
  const key = bucketKey(sessionFile)
  useAdapterStatusBarStore.setState((prev) => {
    const existing = prev.pillsBySession[key] ?? []
    const filtered = existing.filter(
      (item) => !(item.adapterId === event.adapterId && item.statusKey === event.statusKey),
    )
    if (event.phase === 'clear' || !event.text?.trim()) {
      return {
        pillsBySession: {
          ...prev.pillsBySession,
          [key]: filtered,
        },
      }
    }
    return {
      pillsBySession: {
        ...prev.pillsBySession,
        [key]: [
          ...filtered,
          {
            adapterId: event.adapterId,
            statusKey: event.statusKey,
            text: event.text.trim(),
            ...(event.icon ? { icon: event.icon } : {}),
            ...(event.title ? { title: event.title } : {}),
            ...(event.clickAction ? { clickAction: event.clickAction } : {}),
            updatedAt: Date.now(),
          },
        ],
      },
    }
  })
}

export function selectSessionStatusPills(
  pillsBySession: Record<string, StatusBarPillSnapshot[]>,
  sessionFile: string | null | undefined,
): StatusBarPillSnapshot[] {
  if (!sessionFile) return []
  return pillsBySession[bucketKey(sessionFile)] ?? []
}
