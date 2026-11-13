import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dirs = vi.hoisted(() => ({ desktop: '', agent: '' }))
vi.mock('./active-dirs', () => ({ getActiveDesktopDir: () => dirs.desktop, getActiveAgentDir: () => dirs.agent }))
import * as loader from './adapter-loader'
import { probeExtensions } from './extension-probe'

let root: string
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'adapter-catalog-'))
  dirs.desktop = join(root, 'desktop')
  dirs.agent = join(root, 'agent')
  await mkdir(join(dirs.desktop, 'adapters'), { recursive: true })
  await mkdir(dirs.agent, { recursive: true })
  loader.invalidateAdapterCatalog()
})
afterEach(async () => { await rm(root, { recursive: true, force: true }) })
const prepare = loader.prepareAdapterCatalog

describe('scoped adapter catalog', () => {
  it('should_not_match_similar_packages_when_only_exact_aliases_are_declared', () => {
    expect(loader.resolveV2ByPluginName('pi-search-extra')).toBeNull()
    expect(loader.resolveV2ByPluginName('npm:pi-search@2.0.0')?.id).toBe('pi-search')
    expect(loader.resolveV2ByPluginName('git:github.com/justhil/pi-devin-search')?.id).toBe('pi-devin-search')
    expect(loader.resolveV2ByPluginName('npm:@bytetrue/pi-background-terminal')?.id).toBe('@bytetrue/pi-background-terminal')
    expect(loader.resolveV2ByPluginName('npm:@astrosheep/pi-goal-next')?.id).toBe('pi-goal')
    expect(loader.resolveV2ByPluginName('npm:pi-rewind-hook')?.id).toBe('pi-rewind-hook')
    expect(loader.resolveV2ByPluginName('local-packages\\pi-prompt-enhancer')?.id).toBe('pi-prompt-enhancer')
    expect(loader.resolveV2ByPluginName('local-packages/pi-quality')?.id).toBe('pi-quality')
    expect(loader.resolveV2ByPluginName('npm:pi-win-notify@1.0.15')?.tier).toBe('none')
  })

  it('should_isolate_invalid_declarations_when_loading_desktop_contributions', async () => {
    await writeFile(join(dirs.desktop, 'adapters', 'bad.json'), JSON.stringify({ id: 'bad', tier: 'anything', match: { names: 2 } }))
    await writeFile(join(dirs.desktop, 'adapters', 'panel.json'), JSON.stringify({ id: 'local.tasks', kind: 'desktop', tier: 'native', sidePanel: { source: { type: 'json', path: 'tasks.json' }, panelComponent: 'list', label: 'Tasks' } }))
    const catalog = await prepare(root)
    expect(catalog.adapters.some((a) => a.id === 'bad')).toBe(false)
    expect(catalog.adapters.some((a) => a.id === 'local.tasks')).toBe(true)
    expect(catalog.errors.some((a) => a.adapterId === 'bad.json')).toBe(true)
  })

  it('notifies consumers when an existing snapshot changes', async () => {
    const file = join(dirs.desktop, 'adapters', 'panel.json')
    const adapter = { id: 'local.panel', kind: 'desktop', tier: 'native', sidePanel: { panelComponent: 'list', source: { type: 'json', path: 'items.json' }, label: 'Old' } }
    await writeFile(file, JSON.stringify(adapter))
    await prepare(root)
    const notifications: string[] = []
    const dispose = loader.onAdapterCatalogChanged((catalog) => notifications.push(catalog.revision || ''))
    await writeFile(file, JSON.stringify({ ...adapter, sidePanel: { ...adapter.sidePanel, label: 'New' } }))
    const updated = await prepare(root, { refresh: true })
    dispose()
    expect(notifications).toEqual([updated.revision])
  })

  it('reports conflicts without guessing between similar package identities', async () => {
    const dir = join(dirs.desktop, 'adapters')
    for (const name of ['first', 'second']) await writeFile(join(dir, `${name}.json`), JSON.stringify({ id: name, tier: 'partial', match: { names: ['same-package'] } }))
    const result = await prepare(root)
    expect(result.errors.some((error) => error.message.includes('conflicting'))).toBe(true)
    expect(result.adapters.filter((adapter) => adapter.match.names?.includes('same-package'))).toHaveLength(1)
    expect(result.errors.some((error) => error.source === 'builtin')).toBe(false)
  })

  it('should_keep_project_and_runtime_snapshots_separate_when_requests_interleave', async () => {
    const a = join(root, 'a'), b = join(root, 'b')
    for (const [cwd, description] of [[a, 'A'], [b, 'B']]) {
      const dir = join(cwd, '.pi', 'desktop', 'adapters')
      await mkdir(dir, { recursive: true })
      await writeFile(join(dir, 'search.json'), JSON.stringify({ id: 'search-local', tier: 'partial', match: { names: ['pi-search'] }, description }))
    }
    const [ca, cb] = await Promise.all([prepare(a), prepare(b)])
    expect(loader.findAdapterById('search-local', a)?.description).toBe('A')
    expect(loader.findAdapterById('search-local', b)?.description).toBe('B')
    expect(ca).not.toBe(cb)
    expect(await prepare(a)).toBe(ca)
    dirs.desktop = join(root, 'other-runtime')
    expect(loader.findAdapterById('search-local', a)).toBeUndefined()
  })

  it('should_probe_local_packages_and_directory_extension_entries', async () => {
    const localPkgDir = join(dirs.agent, 'local-packages', 'pi-quality')
    const notifyExtDir = join(dirs.agent, 'npm', 'node_modules', 'pi-win-notify', 'extensions')
    await mkdir(localPkgDir, { recursive: true })
    await mkdir(notifyExtDir, { recursive: true })
    await writeFile(
      join(localPkgDir, 'package.json'),
      JSON.stringify({ name: 'pi-quality', version: '0.1.0', pi: { extensions: ['./index.ts'] } }),
    )
    await writeFile(
      join(localPkgDir, 'index.ts'),
      'export default function(pi) { pi.registerCommand("quality", {}); pi.registerCommand("review", {}); }',
    )
    await writeFile(
      join(dirs.agent, 'npm', 'node_modules', 'pi-win-notify', 'package.json'),
      JSON.stringify({ name: 'pi-win-notify', version: '1.0.15', pi: { extensions: ['./extensions'] } }),
    )
    await writeFile(
      join(notifyExtDir, 'desktop-notify.ts'),
      'export default function(pi) { pi.registerCommand("notify", {}); }',
    )
    await writeFile(
      join(dirs.agent, 'settings.json'),
      JSON.stringify({ packages: ['local-packages/pi-quality', 'npm:pi-win-notify@1.0.15'] }),
    )

    const results = probeExtensions(root)
    const quality = results.find((r) => r.name === 'pi-quality')
    const notify = results.find((r) => r.name === 'pi-win-notify')

    expect(quality?.adapterId).toBe('pi-quality')
    expect(quality?.registeredCommands).toEqual(expect.arrayContaining(['quality', 'review']))
    expect(notify?.tuiOnly).toBe(true)
    expect(notify?.registeredCommands).toContain('notify')
  })
})
