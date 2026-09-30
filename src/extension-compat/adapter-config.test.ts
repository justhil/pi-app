import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const mocks = vi.hoisted(() => ({ root: '', home: '', local: new Map<string, Record<string, unknown>>(), openPath: vi.fn(async () => ''), runWslAsync: vi.fn(), reloadResources: vi.fn() }))
vi.mock('../main/wsl/wsl-env', () => ({ resolveWslEnv: async () => ({ shell: '/bin/bash', path: '/usr/bin' }) }))
vi.mock('../main/wsl/wsl-exec', () => ({ runWslAsync: mocks.runWslAsync }))
vi.mock('../main/worker-manager', () => ({ workerManager: { isRunning: true, hasActiveTurns: false, reloadResources: mocks.reloadResources } }))
vi.mock('electron', () => ({ shell: { openPath: mocks.openPath }, net: { fetch: vi.fn() } }))
vi.mock('./active-dirs', () => ({ getActiveDesktopDir: () => join(mocks.root, 'desktop'), getActiveHomeDir: () => mocks.home || mocks.root, getActiveAgentDir: () => join(mocks.root, 'agent') }))
vi.mock('../main/config-store', () => ({ configStore: { getExtensionConfig: (workspace: string, id: string) => mocks.local.get(`${workspace}:${id}`), setExtensionConfig: (workspace: string, id: string, value: Record<string, unknown>) => mocks.local.set(`${workspace}:${id}`, value) } }))
import { readAdapterConfig, writeAdapterConfig, runAdapterAction } from './adapter-backend'
import { invalidateAdapterCatalog } from './adapter-loader'
let cwd: string
beforeEach(async () => {
  mocks.root = await mkdtemp(join(tmpdir(), 'adapter-config-'))
  cwd = join(mocks.root, 'project')
  const dir = join(cwd, '.pi', 'desktop', 'adapters')
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'local.json'), JSON.stringify({ id: 'config-test', match: { names: ['config-test'] }, tier: 'partial', config: { configFile: join(mocks.root, 'config.json'), fileKeyMap: { first: 'first', second: 'second', secret: 'secret' }, sections: [{ fields: [{ key: 'first', type: 'text' }, { key: 'second', type: 'text' }, { key: 'secret', type: 'secret' }] }], actions: [{ id: 'open', type: 'openPath', url: '~' }] } }))
  invalidateAdapterCatalog()
  mocks.local.clear()
  mocks.home = ''
  mocks.runWslAsync.mockReset()
  mocks.reloadResources.mockClear()
})
afterEach(async () => { await rm(mocks.root, { recursive: true, force: true }) })
describe('adapter config persistence', () => {
  it('should_preserve_concurrent_fields_when_project_adapter_writes_the_same_file', async () => {
    await writeFile(join(mocks.root, 'config.json'), JSON.stringify({ unknown: { retained: true }, secret: 'saved-secret' }))
    await Promise.all([writeAdapterConfig('config-test', cwd, { first: 'A' }), writeAdapterConfig('config-test', cwd, { second: 'B', secret: '' })])
    expect(JSON.parse(await readFile(join(mocks.root, 'config.json'), 'utf8'))).toEqual({ unknown: { retained: true }, secret: 'saved-secret', first: 'A', second: 'B' })
    const view = await readAdapterConfig('config-test', cwd)
    expect(view.secretSet).toBe(true)
    expect(view.secret).not.toBe('saved-secret')
  })
  it('should_refuse_overwrite_when_existing_config_is_invalid', async () => {
    await writeFile(join(mocks.root, 'config.json'), '{broken')
    await expect(writeAdapterConfig('config-test', cwd, { first: 'A' })).rejects.toThrow('invalid JSON')
    expect(await readFile(join(mocks.root, 'config.json'), 'utf8')).toBe('{broken')
  })
  it('should_use_linux_overrides_when_the_active_environment_is_wsl', async () => {
    mocks.home = '\\\\wsl.localhost\\Ubuntu\\home\\test'
    vi.stubEnv('PI_ADAPTER_TEST_VALUE', 'windows-value')
    mocks.runWslAsync.mockResolvedValue({ status: 0, stdout: '\n__PI_ADAPTER_ENV__\nPI_ADAPTER_TEST_VALUE=linux-value\0__PI_ADAPTER_END__', stderr: '' })
    const file = join(cwd, '.pi', 'desktop', 'adapters', 'local.json')
    const adapter = JSON.parse(await readFile(file, 'utf8'))
    adapter.config.envOverride = { first: 'PI_ADAPTER_TEST_VALUE' }
    await writeFile(file, JSON.stringify(adapter))
    invalidateAdapterCatalog()
    try {
      expect((await readAdapterConfig('config-test', cwd)).first).toBe('linux-value')
      expect(mocks.runWslAsync).toHaveBeenCalledOnce()
    } finally { vi.unstubAllEnvs() }
  })
  it('should_reload_only_the_requested_workspace_when_an_action_runs', async () => {
    const file = join(cwd, '.pi', 'desktop', 'adapters', 'local.json')
    const adapter = JSON.parse(await readFile(file, 'utf8'))
    adapter.config.actions.push({ id: 'reload', type: 'reload' })
    await writeFile(file, JSON.stringify(adapter))
    invalidateAdapterCatalog()
    expect(await runAdapterAction('config-test', 'reload', cwd)).toMatchObject({ ok: true })
    expect(mocks.reloadResources).toHaveBeenCalledWith(cwd)
  })
  it('should_open_the_path_when_declared_action_is_requested', async () => {
    await expect(runAdapterAction('config-test', 'open', cwd)).resolves.toMatchObject({ ok: true })
    expect(mocks.openPath).toHaveBeenCalledWith(mocks.root)
  })
})
