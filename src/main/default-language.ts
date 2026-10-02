/**
 * Language for a fresh install: Chinese in a Chinese locale, English everywhere else.
 * POSIX locale variables win (LC_ALL > LC_MESSAGES > LANG); without them (Windows, macOS GUI
 * launches) the system locale reported by ICU decides.
 */
export function defaultAppLanguage(
  env: NodeJS.ProcessEnv = process.env,
  systemLocale: string = Intl.DateTimeFormat().resolvedOptions().locale,
): 'zh' | 'en' {
  const locale = env.LC_ALL || env.LC_MESSAGES || env.LANG || systemLocale
  return locale.toLowerCase().startsWith('zh') ? 'zh' : 'en'
}
