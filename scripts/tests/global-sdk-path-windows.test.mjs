import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()

describe('global SDK path discovery', () => {
  it('does not cache failed global resolve', () => {
    const src = readFileSync(join(root, 'src/main/sdk-loader.ts'), 'utf8')
    assert.match(src, /clearGlobalSdkPathCache/)
    assert.doesNotMatch(src, /globalSdkPathCache = null/)
  })

  it('prioritizes npm i -g then pi-node', () => {
    const src = readFileSync(join(root, 'src/main/global-sdk-resolve.ts'), 'utf8')
    assert.match(src, /npmGlobalModuleRootsFromEnv/)
    assert.match(src, /collectNpmGlobalModuleRoots/)
    const fn = src.match(/export function discoverGlobalPiCodingAgentRoot[\s\S]*?^}/m)?.[0] ?? ''
    assert.ok(fn.length > 0)
    const listRun = fn.indexOf("args[0] !== 'list'")
    const npmScan = fn.indexOf('collectNpmGlobalModuleRoots()')
    const shim = fn.indexOf('resolveViaPiShim()')
    const piNode = fn.indexOf('piNodeStyleModuleRoots()')
    assert.ok(listRun >= 0 && npmScan > listRun && shim > npmScan && piNode > shim)
  })
})