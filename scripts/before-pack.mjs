import { collectPiSdkAsarUnpackPatterns } from './lib/pi-sdk-asar-unpack.mjs'

/**
 * Unpack the built-in Pi SDK runtime closure into `app.asar.unpacked` so extensions
 * spawning external Node processes can resolve SDK packages on disk.
 */
export default async function beforePack(context) {
  const projectDir = context.packager.projectDir
  const patterns = collectPiSdkAsarUnpackPatterns(projectDir)
  const rawExisting = context.packager.config.asarUnpack
  const existing = Array.isArray(rawExisting) ? rawExisting : rawExisting ? [rawExisting] : []
  context.packager.config.asarUnpack = Array.from(new Set([...existing, ...patterns]))
}
