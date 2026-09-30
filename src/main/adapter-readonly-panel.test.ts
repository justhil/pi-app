import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const dirs = vi.hoisted(() => ({ root: '' }))
vi.mock('electron', () => ({ shell: {}, net: {} }))
vi.mock('../extension-compat/active-dirs', () => ({ getActiveDesktopDir: () => join(dirs.root, 'desktop'), getActiveHomeDir: () => dirs.root, getActiveAgentDir: () => join(dirs.root, 'agent') }))
vi.mock('./config-store', () => ({ configStore: { getExtensionConfig: () => ({}) } }))
import { resolveSidePanelState } from './side-panel-registry'
import { invalidateAdapterCatalog } from '../extension-compat/adapter-loader'
let cwd: string
async function declaration(path: string) {
  await writeFile(join(cwd, '.pi/desktop/adapters/tasks.json'), JSON.stringify({ id: 'local.tasks', kind: 'desktop', tier: 'native', sidePanel: { panelComponent: 'list', source: { type: 'json', path, itemsPath: 'items', fields: { title: '$.name', description: '$.state' } } } }))
  invalidateAdapterCatalog()
}
beforeEach(async () => { dirs.root = await mkdtemp(join(tmpdir(), 'adapter-panel-')); cwd = join(dirs.root, 'project'); await mkdir(join(cwd, '.pi/desktop/adapters'), { recursive: true }) })
afterEach(async () => { await rm(dirs.root, { recursive: true, force: true }) })
describe('independent readonly panel', () => {
  it('should_read_project_json_when_no_pi_plugin_or_worker_is_bound', async () => {
    await declaration('tasks.json')
    await writeFile(join(cwd, 'tasks.json'), JSON.stringify({ items: [{ name: 'Real task', state: 'pending' }] }))
    const result = await resolveSidePanelState('local.tasks', cwd, cwd)
    expect(result).toMatchObject({ ok: true, state: { items: [{ title: 'Real task', description: 'pending' }] } })
  })
  it('should_reject_outside_paths_when_a_declaration_escapes_the_project', async () => {
    await writeFile(join(dirs.root, 'outside.json'), '{}')
    await declaration('../outside.json')
    await expect(resolveSidePanelState('local.tasks', cwd, cwd)).resolves.toMatchObject({ ok: false, error: 'outside_workspace' })
  })
  it('should_reject_symlink_when_data_file_points_outside_project', async () => {
    await writeFile(join(dirs.root, 'outside.json'), '{}')
    await symlink(join(dirs.root, 'outside.json'), join(cwd, 'linked.json'))
    await declaration('linked.json')
    await expect(resolveSidePanelState('local.tasks', cwd, cwd)).resolves.toMatchObject({ ok: false, error: 'outside_workspace' })
  })
  it('should_reject_large_data_when_json_exceeds_the_read_limit', async () => {
    await declaration('large.json')
    await writeFile(join(cwd, 'large.json'), ' '.repeat(1024 * 1024 + 1))
    await expect(resolveSidePanelState('local.tasks', cwd, cwd)).resolves.toMatchObject({ ok: false, error: 'too_large' })
  })
})
