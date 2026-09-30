import { act, render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ workspace: 'A', invoke: vi.fn() }))
vi.mock('@renderer/stores/ui-store', () => ({ useUIStore: (select: (state: { currentWorkspace: string }) => unknown) => select({ currentWorkspace: mocks.workspace }) }))
vi.mock('@renderer/lib/ipc-client', () => ({ ipcClient: { invoke: mocks.invoke } }))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
import { GenericAdapterSidePanel } from './generic-adapter-side-panel'

it('keeps project B data when project A responds late', async () => {
  let finishA!: (value: unknown) => void
  const a = new Promise((resolve) => { finishA = resolve })
  mocks.invoke.mockImplementation((_method, request) => request.workspaceId === 'A' ? a : Promise.resolve({ ok: true, state: { items: [{ title: 'Project B data' }] } }))
  const props = { panelId: 'local', adapterId: 'local', panelComponent: 'list' }
  const { rerender } = render(<GenericAdapterSidePanel {...props} />)
  mocks.workspace = 'B'
  rerender(<GenericAdapterSidePanel {...props} />)
  await screen.findByText('Project B data')
  await act(async () => { finishA({ ok: true, state: { items: [{ title: 'Old A data' }] } }); await a })
  expect(screen.queryByText('Old A data')).not.toBeInTheDocument()
  expect(screen.getByText('Project B data')).toBeInTheDocument()
})
