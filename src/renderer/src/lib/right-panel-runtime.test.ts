import { beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ workspace: 'A', invoke: vi.fn() }))
vi.mock('./ipc-client', () => ({ ipcClient: { invoke: mocks.invoke } }))
vi.mock('@renderer/stores/ui-store', () => ({ useUIStore: { getState: () => ({ currentWorkspace: mocks.workspace }) } }))
import { invalidateRightPanelCatalog, loadRightPanelCatalog } from './right-panel-runtime'
beforeEach(() => { invalidateRightPanelCatalog(); mocks.workspace = 'A'; mocks.invoke.mockReset() })
it('does not cache project A after the project B directory has loaded', async () => {
  let finishA!: (value: unknown) => void
  mocks.invoke.mockReturnValueOnce(new Promise((resolve) => { finishA = resolve }))
  const old = loadRightPanelCatalog()
  mocks.workspace = 'B'
  invalidateRightPanelCatalog()
  mocks.invoke.mockResolvedValue({ catalog: [{ id: 'B' }] })
  await loadRightPanelCatalog()
  finishA({ catalog: [{ id: 'A' }] })
  await old
  expect((await loadRightPanelCatalog())[0].id).toBe('B')
})
