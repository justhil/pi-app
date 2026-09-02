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

  it('prioritizes spawn-free filesystem layouts (env + pi-node) before npm spawn', () => {
    const src = readFileSync(join(root, 'src/main/global-sdk-resolve.ts'), 'utf8')
    assert.match(src, /npmGlobalModuleRootsFromEnv/)
    assert.match(src, /collectNpmGlobalModuleRoots/)
    const fn = src.match(/export function discoverGlobalPiCodingAgentRoot[\s\S]*?^}/m)?.[0] ?? ''
    assert.ok(fn.length > 0)
    const envScan = fn.indexOf('npmGlobalModuleRootsFromEnv()')
    const piNode = fn.indexOf('piNodeStyleModuleRoots()')
    const listRun = fn.indexOf("args[0] !== 'list'")
    const npmScan = fn.indexOf('collectNpmGlobalModuleRoots()')
    const shim = fn.indexOf('resolveViaPiShim()')
    // 无子进程布局必须排在同步 npm spawn 之前（默认 prefix 安装零阻塞命中）；
    // 且 skipSpawn 模式在 npm 回退前直接返回 null，启动预热绝不触发 spawnSync
    assert.ok(envScan >= 0 && piNode > envScan && piNode < listRun)
    assert.ok(listRun >= 0 && npmScan > listRun && shim > npmScan)
    assert.match(src, /skipSpawn/)
  })
})