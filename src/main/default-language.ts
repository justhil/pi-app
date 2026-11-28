/**
 * Language for a fresh install: match a supported system locale, otherwise use English.
 * POSIX locale variables win (LC_ALL > LC_MESSAGES > LANG); without them (Windows, macOS GUI
 * launches) the system locale reported by ICU decides.
 */
export function defaultAppLanguage(
  env: NodeJS.ProcessEnv = process.env,
  systemLocale: string = Intl.DateTimeFormat().resolvedOptions().locale,
): 'zh' | 'en' | 'ru' | 'ja' {
  const locale = (env.LC_ALL || env.LC_MESSAGES || env.LANG || systemLocale).toLowerCase()
  if (locale.startsWith('zh')) return 'zh'
  if (locale.startsWith('ru')) return 'ru'
  if (locale.startsWith('ja')) return 'ja'
  return 'en'
}
