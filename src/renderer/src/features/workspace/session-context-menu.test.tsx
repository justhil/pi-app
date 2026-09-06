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

  it('delete refreshes the owning workspace', async () => {
    invokeMock.mockResolvedValue({ ok: true })
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const onSessionsChange = vi.fn()
    render(<SessionContextMenuPortal menu={MENU} onClose={() => {}} onSessionsChange={onSessionsChange} />)

    await act(async () => {
      fireEvent.click(screen.getByText('common:sidebar.delete'))
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
    vi.spyOn(window, 'confirm').mockReturnValue(true)
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
