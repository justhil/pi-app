import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

const ROOT_SDK_PACKAGE = '@earendil-works/pi-coding-agent'

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'))
}

function resolveDepPackageDir(fromDir, projectDir, depName) {
  let cursor = resolve(fromDir)
  const stopDir = resolve(projectDir)
  while (true) {
    const candidatePkg = join(cursor, 'node_modules', depName, 'package.json')
    if (existsSync(candidatePkg)) {
      return dirname(candidatePkg)
    }
    if (cursor === stopDir) break
    const parent = dirname(cursor)
    if (parent === cursor) break
    cursor = parent
  }
  return null
}

/**
 * Collect the transitive runtime package closure of `@earendil-works/pi-coding-agent`
 * so child Node processes spawned by extensions can resolve and import SDK peers
 * outside `app.asar`.
 */
export function collectPiSdkClosurePackages(projectDir) {
  const rootDir = resolve(projectDir)
  const sdkDir = join(rootDir, 'node_modules', ROOT_SDK_PACKAGE)
  if (!existsSync(join(sdkDir, 'package.json'))) {
    throw new Error(`Missing ${ROOT_SDK_PACKAGE} under ${rootDir}`)
  }

  const visitedDirs = new Set()
  const packageNames = new Set([ROOT_SDK_PACKAGE])
  const queue = [sdkDir]

  while (queue.length > 0) {
    const currentDir = queue.shift()
    const realDir = realpathSync(currentDir)
    if (visitedDirs.has(realDir)) continue
    visitedDirs.add(realDir)

    const pkg = readJson(join(currentDir, 'package.json'))
    if (typeof pkg.name === 'string' && pkg.name) {
      packageNames.add(pkg.name)
    }

    const depNames = new Set([
      ...Object.keys(pkg.dependencies || {}),
      ...Object.keys(pkg.optionalDependencies || {}),
      ...Object.keys(pkg.peerDependencies || {}),
    ])
    if (pkg.name === 'debug') {
      depNames.add('supports-color')
    }

    // Preserve declared platform optional packages (e.g. @esbuild/* across macOS x64/arm64).
    for (const optName of Object.keys(pkg.optionalDependencies || {})) {
      if (pkg.name === 'esbuild' || optName.startsWith('@esbuild/')) {
        packageNames.add(optName)
      }
    }

    for (const depName of depNames) {
      const resolvedDir = resolveDepPackageDir(currentDir, rootDir, depName)
      if (resolvedDir) {
        packageNames.add(depName)
        queue.push(resolvedDir)
      }
    }
  }

  return Array.from(packageNames).sort()
}

export function collectPiSdkAsarUnpackPatterns(projectDir) {
  return collectPiSdkClosurePackages(projectDir).map((pkgName) => `**/node_modules/${pkgName}/**`)
}
