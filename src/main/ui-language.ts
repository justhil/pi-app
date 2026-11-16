import { configStore } from './config-store'
import type { CompletionUiLanguage } from '@shared/completion-preview'

/**
 * The language the main process writes its own strings in: tray menu, desktop alerts,
 * completion notifications. It follows the app language the user picked in Settings, and
 * is deliberately narrower than the renderer's locale system — the main process has a
 * handful of labels, not a translation table.
 */
export function resolveUiLanguage(): CompletionUiLanguage {
  const language = configStore.get('language')
  if (language === 'ru') return 'ru'
  if (language === 'en') return 'en'
  return 'zh'
}
