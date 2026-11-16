import type { MainUiLanguage } from './main-labels'

/**
 * The language the main process writes its own labels in, kept in a config-free module so
 * that worker/git/WSL helpers can localize without pulling electron-store into their import
 * graph. src/main/ui-language.ts refreshes it whenever it resolves the setting.
 */
let language: MainUiLanguage = 'zh'

export function setMainUiLanguage(next: MainUiLanguage): void {
  language = next
}

export function getMainUiLanguage(): MainUiLanguage {
  return language
}
