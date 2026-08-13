export type NotificationTarget = {
  workspaceId: string
  sessionId?: string
  sessionFile?: string
}

const cache = new Map<string, NotificationTarget>()
const MAX = 32

export function rememberNotificationTarget(id: string, target: NotificationTarget): void {
  cache.set(id, target)
  if (cache.size > MAX) {
    const first = cache.keys().next().value
    if (first) cache.delete(first)
  }
}

export function takeNotificationTarget(id: string): NotificationTarget | undefined {
  return cache.get(id)
}

export function forgetNotificationTarget(id: string): void {
  cache.delete(id)
}

export function clearNotificationTargets(): void {
  cache.clear()
}
