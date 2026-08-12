import { app } from 'electron'
import { join } from 'node:path'

export function resolveUtilityEntry(
  entryName: 'worker.mjs' | 'preview.mjs' | 'preview-wsl.mjs',
  appPath = app.getAppPath(),
): string {
  return join(appPath, 'out', 'main', entryName)
}
