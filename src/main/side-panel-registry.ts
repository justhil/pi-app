import { open, realpath } from 'node:fs/promises'
import { isAbsolute, relative, resolve } from 'node:path'
import { findAdapterById, prepareAdapterCatalog } from '../extension-compat/adapter-loader'
import { readAdapterConfig } from '../extension-compat/adapter-backend'
import { extractJsonPath } from '../extension-compat/json-path'
import type { AdapterSidePanel } from '../extension-compat/adapter-schema'
import { readWorkspaceTaskPanelState } from './workspace-task-panel-reader'

const MAX_JSON_BYTES = 1024 * 1024

async function readJsonPanel(cwd: string, source: NonNullable<AdapterSidePanel['source']>): Promise<unknown> {
  const path = source.path.replace(/\\/g, '/')
  if (isAbsolute(path) || /^[A-Za-z]:/.test(path) || path.split('/').includes('..')) throw new Error('outside_workspace')
  const root = await realpath(cwd)
  const target = await realpath(resolve(root, path))
  const rel = relative(root, target)
  if (rel === '..' || rel.startsWith('..\\') || rel.startsWith('../') || isAbsolute(rel)) throw new Error('outside_workspace')
  const file = await open(target, 'r')
  try {
    const info = await file.stat()
    if (!info.isFile()) throw new Error('not_a_file')
    if (info.size > MAX_JSON_BYTES) throw new Error('too_large')
    const buffer = Buffer.alloc(MAX_JSON_BYTES + 1)
    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0)
    if (bytesRead > MAX_JSON_BYTES) throw new Error('too_large')
    let data: unknown
    try { data = JSON.parse(buffer.subarray(0, bytesRead).toString('utf8')) } catch { throw new Error('invalid_json') }
    if (!source.itemsPath && !source.fields) return data
    const items = source.itemsPath ? extractJsonPath(data, source.itemsPath) : data
    if (!Array.isArray(items)) throw new Error('items_not_array')
    return { items: items.slice(0, 500).map((item) => source.fields ? Object.fromEntries(Object.entries(source.fields).map(([field, pointer]) => [field, extractJsonPath(item, pointer)])) : item), truncated: items.length > 500 }
  } finally {
    await file.close()
  }
}

export async function resolveSidePanelState(adapterId: string, cwd: string, workspaceId: string): Promise<{ ok: true; state: unknown } | { ok: false; error: string }> {
  await prepareAdapterCatalog(cwd)
  const adapter = findAdapterById(adapterId, cwd)
  const panel = adapter?.sidePanel
  if (!panel) return { ok: false, error: 'no_state_provider' }
  try {
    if (panel.source) return { ok: true, state: await readJsonPanel(cwd, panel.source) }
    if (panel.stateProvider !== 'workspace-trellis') return { ok: false, error: `unknown_provider:${panel.stateProvider}` }
    const [base, view] = await Promise.all([readWorkspaceTaskPanelState(cwd), readAdapterConfig(adapterId, workspaceId)])
    const limit = typeof view.journalLimit === 'number' ? view.journalLimit : 5
    return { ok: true, state: { ...base, recentJournals: view.showRecentJournal === false ? [] : base.recentJournals?.slice(0, limit) } }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    return { ok: false, error: code === 'ENOENT' ? 'not_found' : error instanceof Error ? error.message : 'read_failed' }
  }
}
