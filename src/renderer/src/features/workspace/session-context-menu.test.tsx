import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SessionContextMenuPortal } from './session-context-menu'

const invokeMock = vi.fn(async (_method: unknown, _req?: unknown): Promise<unknown> => ({}))
vi.mock('@renderer/lib/ipc-client', () => ({
  ipcClient: { invoke: (method: unknown, req?: unknown) => invokeMock(method, req) },
}))
const workspaceMocks = vi.hoisted(() => ({
  switchSessionInPlace: vi.fn(),
  activateWorkspace: vi.fn(),
}))
const uiState = vi.hoisted(() => ({
  currentSessionId: null as string | null,
  currentWorkspace: '/proj/current',
  sessionAttention: {} as Record<string, string>,
  setCurrentSession: () => {},
  clearTimeline: () => {},
  loadHistoryItems: () => {},
  setHistoryMeta: () => {},
}))
vi.mock('@renderer/lib/activate-workspace', () => workspaceMocks)
const forkMocks = vi.hoisted(() => ({
  loadForkCandidates: vi.fn(async (_source?: unknown) => [
    { entryId: 'e1', text: 'first question' },
    { entryId: 'e2', text: 'second question' },
  ]),
  forkSessionFromEntry: vi.fn(async (_entryId: string, _source?: unknown) => true),
  cloneCurrentSession: vi.fn(async (_source?: unknown) => true),
}))
vi.mock('@renderer/lib/session-fork', () => forkMocks)
vi.mock('@renderer/lib/session-switch-guard', () => ({ guardSessionSwitch: (action: () => void) => action() }))
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}))
vi.mock('@renderer/stores/ui-store', () => ({
  useUIStore: Object.assign((selector?: (state: typeof uiState) => unknown) => (selector ? selector(uiState) : uiState), {
    getState: () => uiState,
    setState: () => {},
  }),
}))
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}))

const MENU = {
  x: 10,
  y: 10,
  target: {
    sessionId: 's1',
    sessionFile: '/proj/a/s1.jsonl',
    title: '旧标题',
    workspacePath: '/proj/a',
  },
}

describe('SessionContextMenuPortal mutations refresh the owning workspace', () => {
  afterEach(() => {
    invokeMock.mockClear()
    workspaceMocks.switchSessionInPlace.mockClear()
    workspaceMocks.activateWorkspace.mockClear()
  })

  it('should_activate_owning_workspace_when_continuing_a_foreign_session', async () => {
    render(<SessionContextMenuPortal menu={MENU} onClose={() => {}} onSessionsChange={() => {}} />)

    await act(async () => {
      fireEvent.click(screen.getByText('common:sidebar.continue'))
    })

    expect(workspaceMocks.activateWorkspace).toHaveBeenCalledWith('/proj/a', {
      sessionId: 's1',
      sessionFile: '/proj/a/s1.jsonl',
    })
    expect(workspaceMocks.switchSessionInPlace).not.toHaveBeenCalled()
  })

  // #94: a native window.confirm leaves Windows Electron pages untypable until alt-tab
  // (electron/electron#19977, #31917) — delete must confirm in-app.
  it('delete confirms in-app instead of the native window.confirm', async () => {
    invokeMock.mockResolvedValue({ ok: true })
    const nativeConfirm = vi.spyOn(window, 'confirm')
    render(<SessionContextMenuPortal menu={MENU} onClose={() => {}} onSessionsChange={() => {}} />)

    await act(async () => {
      fireEvent.click(screen.getByText('common:sidebar.delete'))
    })

    expect(nativeConfirm).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(invokeMock).not.toHaveBeenCalledWith('session.delete', expect.anything())
  })

  it('delete refreshes the owning workspace', async () => {
    invokeMock.mockResolvedValue({ ok: true })
    const onSessionsChange = vi.fn()
    render(<SessionContextMenuPortal menu={MENU} onClose={() => {}} onSessionsChange={onSessionsChange} />)

    await act(async () => {
      fireEvent.click(screen.getByText('common:sidebar.delete'))
    })
    await act(async () => {
      fireEvent.click(screen.getByText('common:confirm'))
    })

    expect(invokeMock).toHaveBeenCalledWith('session.delete', {
      sessionFile: '/proj/a/s1.jsonl',
      workspaceId: '/proj/a',
    })
    expect(onSessionsChange).toHaveBeenCalledWith('/proj/a')
  })

  it('rename refreshes the owning workspace', async () => {
    invokeMock.mockResolvedValue({ ok: true })
    const onSessionsChange = vi.fn()
    render(<SessionContextMenuPortal menu={MENU} onClose={() => {}} onSessionsChange={onSessionsChange} />)

    await act(async () => {
      fireEvent.click(screen.getByText('common:sidebar.rename'))
    })
    const input = document.querySelector('input[type="text"]') as HTMLInputElement
    fireEvent.change(input, { target: { value: '新标题' } })
    await act(async () => {
      fireEvent.click(screen.getByText('common:confirm'))
    })

    expect(invokeMock).toHaveBeenCalledWith('session.rename', {
      sessionId: 's1',
      sessionFile: '/proj/a/s1.jsonl',
      title: '新标题',
      workspaceId: '/proj/a',
    })
    expect(onSessionsChange).toHaveBeenCalledWith('/proj/a')
  })

  it('rename applies the title in place when onSessionRenamed is provided', async () => {
    invokeMock.mockResolvedValue({ ok: true })
    const onSessionsChange = vi.fn()
    const onSessionRenamed = vi.fn()
    render(
      <SessionContextMenuPortal
        menu={MENU}
        onClose={() => {}}
        onSessionsChange={onSessionsChange}
        onSessionRenamed={onSessionRenamed}
      />,
    )

    await act(async () => {
      fireEvent.click(screen.getByText('common:sidebar.rename'))
    })
    const input = document.querySelector('input[type="text"]') as HTMLInputElement
    fireEvent.change(input, { target: { value: '新标题' } })
    await act(async () => {
      fireEvent.click(screen.getByText('common:confirm'))
    })

    expect(onSessionRenamed).toHaveBeenCalledWith({
      sessionFile: '/proj/a/s1.jsonl',
      title: '新标题',
      workspacePath: '/proj/a',
    })
    // 原地更新时不再整列表重拉
    expect(onSessionsChange).not.toHaveBeenCalled()
  })

  it('delete optimistically removes the entry before the IPC resolves', async () => {
    let resolveDelete: (v: unknown) => void = () => {}
    invokeMock.mockImplementation(async (method: unknown) => {
      if (method === 'session.delete') return new Promise<unknown>((r) => (resolveDelete = r))
      return { ok: true }
    })
    const onSessionRemoved = vi.fn()
    render(
      <SessionContextMenuPortal
        menu={MENU}
        onClose={() => {}}
        onSessionsChange={() => {}}
        onSessionRemoved={onSessionRemoved}
      />,
    )

    await act(async () => {
      fireEvent.click(screen.getByText('common:sidebar.delete'))
    })
    await act(async () => {
      fireEvent.click(screen.getByText('common:confirm'))
    })

    // 乐观移除在 IPC 完成前就已发生
    expect(onSessionRemoved).toHaveBeenCalledWith({
      sessionFile: '/proj/a/s1.jsonl',
      workspacePath: '/proj/a',
    })
    await act(async () => {
      resolveDelete({ ok: true })
    })
  })
})

describe('SessionContextMenuPortal fork submenu', () => {
  const source = { sessionFile: '/proj/a/s1.jsonl', workspacePath: '/proj/a' }
  const menu = { ...MENU, target: { ...MENU.target, forks: [{ sessionId: 'f1', sessionFile: '/proj/a/f1.jsonl', title: 'Fork A' }] } }

  afterEach(() => {
    forkMocks.forkSessionFromEntry.mockClear()
    forkMocks.cloneCurrentSession.mockClear()
    workspaceMocks.activateWorkspace.mockClear()
  })

  async function openSubmenu(onClose = vi.fn(), onSessionsChange = vi.fn()) {
    render(<SessionContextMenuPortal menu={menu} onClose={onClose} onSessionsChange={onSessionsChange} />)
    await act(async () => {
      fireEvent.pointerEnter(screen.getByText('common:sidebar.fork'))
    })
    return { onClose, onSessionsChange }
  }

  it('lists the newest user messages first and forks the right-clicked session from one', async () => {
    const { onClose, onSessionsChange } = await openSubmenu()
    expect(forkMocks.loadForkCandidates).toHaveBeenCalledWith(source)
    const items = screen.getAllByRole('menuitem').map((el) => el.textContent)
    expect(items.indexOf('second question')).toBeLessThan(items.indexOf('first question'))

    await act(async () => {
      fireEvent.click(screen.getByText('first question'))
    })
    expect(onClose).toHaveBeenCalled()
    expect(forkMocks.forkSessionFromEntry).toHaveBeenCalledWith('e1', source)
    expect(onSessionsChange).toHaveBeenCalledWith('/proj/a')
  })

  it('duplicates the whole conversation of the right-clicked session', async () => {
    const opened = vi.fn()
    window.addEventListener('pi-desktop:open-fork-selector', opened)
    await openSubmenu()
    await act(async () => {
      fireEvent.click(screen.getByText('common:sidebar.forkClone'))
    })
    expect(forkMocks.cloneCurrentSession).toHaveBeenCalledWith(source)
    window.removeEventListener('pi-desktop:open-fork-selector', opened)
  })

  it('opens the message picker for the right-clicked session', async () => {
    const opened = vi.fn()
    window.addEventListener('pi-desktop:open-fork-selector', opened)
    await openSubmenu()
    await act(async () => {
      fireEvent.click(screen.getByText('common:sidebar.forkChooseMessage'))
    })
    expect((opened.mock.calls[0][0] as CustomEvent).detail).toEqual({ source })
    window.removeEventListener('pi-desktop:open-fork-selector', opened)
  })

  it('jumps to an existing fork', async () => {
    await openSubmenu()
    await act(async () => {
      fireEvent.click(screen.getByText('Fork A'))
    })
    expect(workspaceMocks.activateWorkspace).toHaveBeenCalledWith('/proj/a', { sessionId: 'f1', sessionFile: '/proj/a/f1.jsonl' })
  })
})

describe('SessionContextMenuPortal viewport clamping (#149)', () => {
  const origInnerWidth = window.innerWidth
  const origInnerHeight = window.innerHeight
  const origRect = HTMLElement.prototype.getBoundingClientRect

  afterEach(() => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: origInnerWidth })
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: origInnerHeight })
    HTMLElement.prototype.getBoundingClientRect = origRect
    document.documentElement.style.zoom = ''
  })

  it('flips upward when opened near the bottom of the viewport and accounts for UI zoom', () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1200 })
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 750 })
    document.documentElement.style.zoom = '1.25'
    HTMLElement.prototype.getBoundingClientRect = function () {
      if (this.getAttribute('role') === 'menu') {
        return {
          left: 0,
          top: 0,
          right: 250,
          bottom: 350,
          width: 250,
          height: 350,
          x: 0,
          y: 0,
          toJSON: () => ({}),
        } as DOMRect
      }
      return origRect.call(this)
    }

    render(
      <SessionContextMenuPortal
        menu={{ ...MENU, x: 100, y: 700 }}
        onClose={() => {}}
        onSessionsChange={() => {}}
      />,
    )

    const panel = screen.getByRole('menu')
    // Viewport in CSS pixels: 1200/1.25=960 x 750/1.25=600; click at (80, 560), menu size 200x280 -> flips above to y=280.
    expect(panel.style.left).toBe('80px')
    expect(panel.style.top).toBe('280px')
    expect(panel.style.maxHeight).toBe('584px')
  })
})
