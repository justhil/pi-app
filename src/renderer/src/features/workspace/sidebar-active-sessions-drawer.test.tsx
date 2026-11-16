import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useUIStore } from '@renderer/stores/ui-store'
import { SidebarActiveSessionsDrawer } from './sidebar-active-sessions-drawer'

const switchSessionInPlaceMock = vi.fn<(...args: unknown[]) => Promise<void>>(() => Promise.resolve())
const activateWorkspaceMock = vi.fn<(...args: unknown[]) => Promise<void>>(() => Promise.resolve())

vi.mock('@renderer/lib/activate-workspace', () => ({
  switchSessionInPlace: (...args: unknown[]) => switchSessionInPlaceMock(...args),
  activateWorkspace: (...args: unknown[]) => activateWorkspaceMock(...args),
}))

vi.mock('@renderer/lib/ipc-client', () => ({
  ipcClient: {
    invoke: vi.fn((channel: string) => {
      if (channel === 'settings.get') return Promise.resolve({ settings: { sessionDisplayNames: {} } })
      if (channel === 'session.prepare') {
        return Promise.resolve({
          sessionId: 'other-id',
          sessionFile: '/other/s2.jsonl',
          workspaceId: '/workspace/other-proj',
        })
      }
      return Promise.resolve({})
    }),
  },
}))

describe('SidebarActiveSessionsDrawer', () => {
  beforeEach(() => {
    switchSessionInPlaceMock.mockClear()
    activateWorkspaceMock.mockClear()
    const now = Date.now()
    useUIStore.setState({
      sidebarCollapsed: false,
      sidebarActiveSessionsDrawer: true,
      sidebarActiveSessionsOpen: true,
      currentWorkspace: '/workspace/pi-app',
      historySessionFile: '/workspace/pi-app/s1.jsonl',
      sessions: [
        {
          sessionId: 's1',
          sessionFile: '/workspace/pi-app/s1.jsonl',
          title: 'Current running task',
          workspaceId: '/workspace/pi-app',
          updatedAt: now - 10_000,
          modelId: 'gpt',
        },
        {
          sessionId: 's-unread',
          sessionFile: '/workspace/pi-app/s-unread.jsonl',
          title: 'Finished unread task',
          workspaceId: '/workspace/pi-app',
          updatedAt: now - 60_000,
          modelId: 'gpt',
        },
        {
          sessionId: 's-recent',
          sessionFile: '/workspace/pi-app/s-recent.jsonl',
          title: 'Read 15m ago task',
          workspaceId: '/workspace/pi-app',
          updatedAt: now - 900_000,
          modelId: 'gpt',
        },
      ],
      sessionAttention: {
        '/workspace/pi-app/s1.jsonl': 'working',
        '/workspace/pi-app/s-unread.jsonl': 'done',
      },
      sessionLastActiveAt: {
        '/workspace/pi-app/s1.jsonl': now - 10_000,
        '/workspace/pi-app/s-unread.jsonl': now - 60_000,
        '/workspace/pi-app/s-recent.jsonl': now - 900_000,
      },
    })
  })

  it('starts expanded by default, stays open on outside clicks, and toggles only via header', () => {
    render(
      <div>
        <div data-testid="outside-area">Outside</div>
        <SidebarActiveSessionsDrawer />
      </div>,
    )

    const drawer = screen.getByTestId('sidebar-active-sessions-drawer')
    expect(drawer).toBeInTheDocument()
    expect(screen.getByText('Current running task')).toBeInTheDocument()
    expect(screen.getByText('Finished unread task')).toBeInTheDocument()
    expect(screen.getByText('Read 15m ago task')).toBeInTheDocument()

    // Clicking outside does NOT close the drawer
    fireEvent.pointerDown(screen.getByTestId('outside-area'))
    fireEvent.click(screen.getByTestId('outside-area'))
    expect(useUIStore.getState().sidebarActiveSessionsOpen).toBe(true)

    // Clicking the header collapses and re-expands the drawer
    const headerBtn = drawer.querySelector('button[aria-expanded]')!
    fireEvent.click(headerBtn)
    expect(useUIStore.getState().sidebarActiveSessionsOpen).toBe(false)
    fireEvent.click(headerBtn)
    expect(useUIStore.getState().sidebarActiveSessionsOpen).toBe(true)
  })

  it('switches session on click and hides when disabled in settings', () => {
    const { rerender } = render(<SidebarActiveSessionsDrawer />)

    fireEvent.click(screen.getByText('Finished unread task'))
    expect(switchSessionInPlaceMock).toHaveBeenCalledWith('s-unread', '/workspace/pi-app/s-unread.jsonl')

    act(() => {
      useUIStore.getState().setSidebarActiveSessionsDrawer(false)
    })
    rerender(<SidebarActiveSessionsDrawer />)
    expect(screen.queryByTestId('sidebar-active-sessions-drawer')).toBeNull()
  })
})
