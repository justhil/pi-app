import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const spawnSyncSpy = vi.fn(
  (..._args: unknown[]) => ({ error: null, status: 0, stdout: '', stderr: '' }),
)

vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>()
  return {
    ...actual,
    spawnSync: (...args: Parameters<typeof import('child_process').spawnSync>) =>
      spawnSyncSpy(...args),
  }
})

import { discoverGlobalPiCodingAgentRoot } from './global-sdk-resolve'

let tempRoot: string | null = null

beforeEach(() => {
  spawnSyncSpy.mockClear()
  // 清掉可能指向真实全局安装的环境变量，确保临时 APPDATA 布局成为第一个纯文件系统候选
  delete process.env.npm_config_prefix
  delete process.env.NPM_CONFIG_PREFIX
  delete process.env.APPDATA
  delete process.env.LOCALAPPDATA
  delete process.env.PI_MANAGED_INSTALL_ROOT
  delete process.env.PI_CODING_AGENT_DIR
})

afterEach(() => {
  if (tempRoot) {
    rmSync(tempRoot, { recursive: true, force: true })
    tempRoot = null
  }
})

describe('discoverGlobalPiCodingAgentRoot', () => {
  it('finds a default npm-global layout via env paths without spawning any child process', () => {
    // 构造一个与默认 npm prefix 布局一致的临时全局安装：
    //   <tmp>/npm/node_modules/@earendil-works/pi-coding-agent/{package.json,index.js}
    // 再让 APPDATA 指向 <tmp> —— 纯文件系统检查即可命中，不依赖开发者本机的真实安装，
    // 也不应在第一次命中前付出任何同步 npm spawn（那会阻塞 Electron 主进程）。
    tempRoot = mkdtempSync(join(tmpdir(), 'pi-sdk-resolve-'))
    const pkgRoot = join(tempRoot, 'npm', 'node_modules', '@earendil-works', 'pi-coding-agent')
    mkdirSync(pkgRoot, { recursive: true })
    writeFileSync(
      join(pkgRoot, 'package.json'),
      JSON.stringify({
        name: '@earendil-works/pi-coding-agent',
        version: '0.0.0',
        main: './index.js',
      }),
    )
    writeFileSync(join(pkgRoot, 'index.js'), '')
    process.env.APPDATA = tempRoot

    const root = discoverGlobalPiCodingAgentRoot()
    expect(root).toBe(join(pkgRoot))
    expect(spawnSyncSpy).not.toHaveBeenCalled()
  })

  it('should_find_pi_managed_install_releases_v1_layout_without_spawning_child_process', () => {
    tempRoot = mkdtempSync(join(tmpdir(), 'pi-sdk-managed-'))
    const agentDir = join(tempRoot, '.pi', 'agent')
    const installDir = join(agentDir, 'install')
    const pkgRoot = join(
      installDir,
      'releases',
      '1.5.0',
      'node_modules',
      '@earendil-works',
      'pi-coding-agent',
    )
    mkdirSync(pkgRoot, { recursive: true })
    writeFileSync(join(installDir, 'current-version'), '1.5.0\n')
    writeFileSync(
      join(pkgRoot, 'package.json'),
      JSON.stringify({
        name: '@earendil-works/pi-coding-agent',
        version: '1.5.0',
        exports: { '.': { import: './dist/index.js' } },
      }),
    )
    mkdirSync(join(pkgRoot, 'dist'), { recursive: true })
    writeFileSync(join(pkgRoot, 'dist', 'index.js'), '')
    process.env.PI_CODING_AGENT_DIR = agentDir

    const root = discoverGlobalPiCodingAgentRoot({ skipSpawn: true })
    expect(root).toBe(join(pkgRoot))
    expect(spawnSyncSpy).not.toHaveBeenCalled()
  })
})
