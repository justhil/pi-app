import { app } from 'electron'
import { basename, dirname, join } from 'node:path'

export function resolveUtilityEntry(
  entryName: 'worker.mjs' | 'preview.mjs' | 'preview-wsl.mjs',
  appPath = app.getAppPath(),
): string {
  const mainDir = basename(appPath) === 'main' && basename(dirname(appPath)) === 'out'
    ? appPath
    : join(appPath, 'out', 'main')
  return join(mainDir, entryName)
}
