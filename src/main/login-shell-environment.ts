export type ProcessEnvironment = Record<string, string | undefined>

interface MergeLoginShellEnvironmentOptions {
  launchEnvironment: ProcessEnvironment
  loginShellEnvironment: Readonly<Record<string, string>>
  pathDelimiter: string
}

const EXCLUDED_SHELL_VARIABLE_NAMES = new Set([
  'DISABLE_AUTO_UPDATE',
  'ZSH_TMUX_AUTOSTARTED',
  'ZSH_TMUX_AUTOSTART',
  '_',
  'PWD',
  'OLDPWD',
  'SHLVL',
  'NODE_OPTIONS',
  'NODE_CHANNEL_FD',
  'NODE_CHANNEL_SERIALIZATION_MODE',
  'NODE_UNIQUE_ID',
  'TERM',
  'TERM_PROGRAM',
  'TERM_PROGRAM_VERSION',
  'TERM_SESSION_ID',
  'ITERM_SESSION_ID',
  'COLORTERM',
  'LC_TERMINAL',
  'LC_TERMINAL_VERSION',
])

function shouldImportShellVariable(variableName: string): boolean {
  if (variableName === 'PATH') return false
  if (variableName.startsWith('ELECTRON_')) return false
  return !EXCLUDED_SHELL_VARIABLE_NAMES.has(variableName)
}

function mergeEnvironmentPath(
  loginShellPath: string | undefined,
  launchPath: string | undefined,
  pathDelimiter: string,
): string | undefined {
  const pathEntries = [loginShellPath, launchPath]
    .flatMap((pathValue) => pathValue?.split(pathDelimiter) ?? [])
    .map((pathEntry) => pathEntry.trim())
    .filter(Boolean)

  if (pathEntries.length === 0) return undefined
  return [...new Set(pathEntries)].join(pathDelimiter)
}

export function mergeLoginShellEnvironment({
  launchEnvironment,
  loginShellEnvironment,
  pathDelimiter,
}: MergeLoginShellEnvironmentOptions): ProcessEnvironment {
  const mergedEnvironment: ProcessEnvironment = { ...launchEnvironment }

  for (const [variableName, variableValue] of Object.entries(loginShellEnvironment)) {
    const launchDefinesVariable = Object.prototype.hasOwnProperty.call(
      launchEnvironment,
      variableName,
    )
    if (launchDefinesVariable || !shouldImportShellVariable(variableName)) continue
    mergedEnvironment[variableName] = variableValue
  }

  const mergedPath = mergeEnvironmentPath(
    loginShellEnvironment.PATH,
    launchEnvironment.PATH,
    pathDelimiter,
  )
  if (mergedPath) mergedEnvironment.PATH = mergedPath

  return mergedEnvironment
}
