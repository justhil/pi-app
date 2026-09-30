import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dirs = vi.hoisted(() => ({ desktop: '' }))
vi.mock('./active-dirs', () => ({ getActiveDesktopDir: () => dirs.desktop }))
import * as loader from './adapter-loader'

let root: string
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'adapter-catalog-'))
  dirs.desktop = join(root, 'desktop')
  await mkdir(join(dirs.desktop, 'adapters'), { recursive: true })
  loader.invalidateAdapterCatalog()
})
afterEach(async () => { await rm(root, { recursive: true, force: true }) })
const prepare = loader.prepareAdapterCatalog

describe('scoped adapter catalog', () => {
  it('should_not_match_similar_packages_when_only_exact_aliases_are_declared', () => {
    expect(loader.resolveV2ByPluginName('pi-search-extra')).toBeNull()
    expect(loader.resolveV2ByPluginName('npm:pi-search@2.0.0')?.id).toBe('pi-search')
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
})
