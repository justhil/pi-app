import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SandboxContextMenuPortal } from './sandbox-context-menu'

const invokeMock = vi.fn(async (_method: unknown, _req?: unknown) => ({}))
vi.mock('@renderer/lib/ipc-client', () => ({
  ipcClient: { invoke: (method: unknown, req?: unknown) => invokeMock(method, req) },
}))
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}))
vi.mock('@renderer/stores/ui-store', () => ({
  useUIStore: {
    getState: () => ({ currentWorkspace: null, setWorkspace: () => {}, clearTimeline: () => {}, setCurrentSession: () => {}, loadHistoryItems: () => {}, setHistoryMeta: () => {} }),
    setState: () => {},
  },
}))
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}))

const MENU = { x: 10, y: 10, path: '/sandbox-workspaces/abc', label: '临时对话 abc', sessionFile: '/sandbox-workspaces/abc/s.jsonl' }

describe('SandboxContextMenuPortal rename auto-name', () => {
  afterEach(() => {
    invokeMock.mockClear()
  })

  it('offers 自动生成 in the rename dialog when a session file is bound', async () => {
    invokeMock.mockResolvedValue({ ok: true, title: '帮我修 bug' })
    const onClose = vi.fn()
    const { rerender } = render(
      <SandboxContextMenuPortal menu={MENU} onClose={onClose} onListChange={() => {}} />,
    )
    await act(async () => {
      fireEvent.click(screen.getByText('common:sidebar.rename'))
    })
    rerender(<SandboxContextMenuPortal menu={null} onClose={onClose} onListChange={() => {}} />)

    const autoButton = screen.getByText('common:sidebar.autoGenerate')
    expect(autoButton).toBeTruthy()
    await act(async () => {
      fireEvent.click(autoButton)
    })
    expect(invokeMock).toHaveBeenCalledWith('session.autoNamePreview', {
      sessionFile: '/sandbox-workspaces/abc/s.jsonl',
    })
    expect((document.querySelector('input[type="text"]') as HTMLInputElement).value).toBe('帮我修 bug')
  })

  it('hides 自动生成 when the sandbox has no bound session file', async () => {
    render(
      <SandboxContextMenuPortal
        menu={{ ...MENU, sessionFile: undefined }}
        onClose={() => {}}
        onListChange={() => {}}
      />,
    )
    await act(async () => {
      fireEvent.click(screen.getByText('common:sidebar.rename'))
    })
    expect(screen.queryByText('common:sidebar.autoGenerate')).toBeNull()
  })
})
