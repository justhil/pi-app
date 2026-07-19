import fixPath from 'fix-path'
import { shellEnvSync } from 'shell-env'
import { mergeLoginShellEnvironment } from './login-shell-environment'

if (process.platform === 'darwin') {
  try {
    const mergedEnvironment = mergeLoginShellEnvironment({
      launchEnvironment: { ...process.env },
      loginShellEnvironment: shellEnvSync(),
      pathDelimiter: ':',
    })

    for (const [variableName, variableValue] of Object.entries(mergedEnvironment)) {
      if (typeof variableValue === 'string') process.env[variableName] = variableValue
    }
  } catch {
    console.warn('[bootstrap] Unable to load the macOS login shell environment')
  }
} else {
  fixPath()
}