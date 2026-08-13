import {
  normalizeCompletionDelivery,
  normalizeCompletionPreviewMode,
  normalizeCompletionTimeoutSeconds,
  normalizeDndUntil,
} from '@shared/completion-preview'
import { configStore } from './config-store'
import type { CompletionNotificationSettings } from './completion-notification-controller'

export function readCompletionNotificationSettings(now = Date.now()): CompletionNotificationSettings {
  const language = configStore.get('language') === 'en' ? 'en' : 'zh'
  return {
    soundEnabled: configStore.get('alertSoundEnabled') !== false,
    notificationEnabled: configStore.get('alertNotificationEnabled') !== false,
    alertOnRunIdle: configStore.get('alertOnRunIdle') !== false,
    alertOnBackgroundRunIdle: configStore.get('alertOnBackgroundRunIdle') === true,
    alertOnRunFailed: configStore.get('alertOnRunFailed') !== false,
    alertOnCancelled: false,
    timeoutSeconds: normalizeCompletionTimeoutSeconds(configStore.get('completionNotificationTimeoutSeconds')),
    previewMode: normalizeCompletionPreviewMode(configStore.get('completionNotificationPreview')),
    onlyWhenUnfocused: configStore.get('completionNotificationOnlyWhenUnfocused') !== false,
    dndUntil: normalizeDndUntil(configStore.get('completionNotificationDndUntil'), now),
    delivery: normalizeCompletionDelivery(configStore.get('completionNotificationDelivery')),
    language,
  }
}

export function setCompletionDndUntil(until: number | null): void {
  configStore.set('completionNotificationDndUntil', until)
}
