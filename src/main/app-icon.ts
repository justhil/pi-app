import { nativeImage } from 'electron'
import { existsSync } from 'fs'
import { join } from 'path'

export function appIconCandidates(
  platform = process.platform,
  resourcesPath = process.resourcesPath,
  moduleDir = __dirname,
): string[] {
  const icoCandidates = platform === 'win32'
    ? [
        join(resourcesPath, 'build', 'icon.ico'),
        join(moduleDir, '../../build/icon.ico'),
      ]
    : []

  return [
    ...icoCandidates,
    join(resourcesPath, 'build', 'icon.png'),
    join(moduleDir, '../../build/icon.png'),
    join(moduleDir, '../../resources/icon.png'),
  ]
}

export function resolveAppIcon(): Electron.NativeImage | undefined {
  for (const path of appIconCandidates()) {
    if (!existsSync(path)) continue
    const image = nativeImage.createFromPath(path)
    if (!image.isEmpty()) return image
  }
  return undefined
}
