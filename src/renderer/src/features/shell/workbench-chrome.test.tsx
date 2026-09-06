import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useUIStore } from '@renderer/stores/ui-store'
import { StatusBar } from './status-bar'
import { NotificationInbox } from './notification-inbox'

const mocks = vi.hoisted(() => ({ invoke: vi.fn().mockResolvedValue({}), switchSession: vi.fn(), activateWorkspace: vi.fn() }))
vi.mock('react-i18next', async (importOriginal) => ({ ...await importOriginal<typeof import('react-i18next')>(), useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }) }))
vi.mock('@renderer/lib/ipc-client', () => ({ ipcClient: { invoke: mocks.invoke }, onAppUpdateAvailable: () => () => {} }))
vi.mock('@renderer/lib/activate-workspace', () => ({ switchSessionInPlace: mocks.switchSession, activateWorkspace: mocks.activateWorkspace }))
vi.mock('@renderer/lib/app-update-notify', () => ({ showAppUpdateDialog: vi.fn() }))

const session = { sessionId: 'wait', sessionFile: '/sessions/wait.jsonl', title: 'A long session title that remains readable in the activity list', workspaceId: '/project', modelId: '', updatedAt: 1 }
const worker = { sessionFile: session.sessionFile, running: true, cwd: '/project' }

beforeEach(() => {
  vi.clearAllMocks()
  useUIStore.setState({ currentWorkspace: '/project', sessions: [session], sessionAttention: { [session.sessionFile]: 'needs-you' } })
  mocks.switchSession.mockResolvedValue(undefined)
  mocks.activateWorkspace.mockResolvedValue(undefined)
  mocks.invoke.mockImplementation(async (method: string) => {
    if (method === 'desktop.status') return { rss: 256 * 1024 ** 2, total: 16 * 1024 ** 3, workers: [worker] }
    if (method === 'notifications.inbox') return { items: [] }
    return { ok: true }
  })
})

describe('Workbench status and popovers', () => {
  it('opens activity from the left summary and returns focus on Escape', async () => {
    render(<StatusBar />)
    const trigger = screen.getByRole('button', { name: 'common:board.title' })
    fireEvent.click(trigger)
    const panel = await screen.findByRole('dialog', { name: 'common:board.title' })
    expect(within(panel).getByText(session.title)).toBeInTheDocument()
    expect(within(panel).queryByText('common:statusBar.kill')).not.toBeInTheDocument()
    expect(within(panel).getByRole('button', { name: 'common:close' })).toHaveFocus()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })

  it('opens resources from memory, confirms stop and uses the existing command', async () => {
    render(<StatusBar />)
    await screen.findByText('256 MB')
    fireEvent.click(screen.getByRole('button', { name: 'common:statusBar.resources' }))
    const panel = screen.getByRole('dialog', { name: 'common:statusBar.resources' })
    fireEvent.click(within(panel).getByRole('button', { name: 'common:statusBar.kill' }))
    expect(within(panel).getByText('common:statusBar.stopConfirm')).toBeInTheDocument()
    expect(mocks.invoke).not.toHaveBeenCalledWith('desktop.killWorker', expect.anything())
    fireEvent.click(within(panel).getByRole('button', { name: 'common:statusBar.kill' }))
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith('desktop.killWorker', { sessionFile: session.sessionFile }))
  })

  it('dismisses on outside pointer input without an overlay blocking the app', async () => {
    render(<><input aria-label="outside" /><StatusBar /></>)
    fireEvent.click(screen.getByRole('button', { name: 'common:board.title' }))
    await screen.findByRole('dialog')
    fireEvent.pointerDown(screen.getByRole('textbox', { name: 'outside' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('does not claim an empty resource list when loading failed', async () => {
    mocks.invoke.mockImplementation(async (method: string) => {
      if (method === 'desktop.status') throw new Error('offline')
      return { ok: true }
    })
    render(<StatusBar />)
    fireEvent.click(screen.getByRole('button', { name: 'common:statusBar.resources' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('common:statusBar.loadFailed')
    expect(screen.queryByText('common:statusBar.noWorkers')).not.toBeInTheDocument()
  })

  it('routes a session to its owning project instead of the current one', async () => {
    useUIStore.setState({ currentWorkspace: '/other' })
    render(<StatusBar />)
    fireEvent.click(screen.getByRole('button', { name: 'common:board.title' }))
    fireEvent.click(await screen.findByRole('button', { name: new RegExp(session.title) }))
    await waitFor(() => expect(mocks.activateWorkspace).toHaveBeenCalledWith('/project', { sessionId: 'wait', sessionFile: session.sessionFile }))
    expect(mocks.switchSession).not.toHaveBeenCalled()
  })
})

describe('Notification inbox feedback', () => {
  it('shows a real empty state and a recoverable load error separately', async () => {
    useUIStore.setState({ sessionAttention: {} })
    render(<NotificationInbox />)
    fireEvent.click(screen.getByRole('button', { name: 'common:notification.inbox' }))
    expect(await screen.findByText('common:notification.empty')).toBeInTheDocument()
    mocks.invoke.mockRejectedValue(new Error('offline'))
    fireEvent.click(screen.getByRole('button', { name: 'common:refresh' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('common:notification.loadFailed')
    expect(screen.queryByText('common:notification.empty')).not.toBeInTheDocument()
  })

  it('shows timestamps and waits for unread mutation before reloading', async () => {
    useUIStore.setState({ sessionAttention: {} })
    const item = { notificationId: 'n1', workspaceId: '/project', sessionFile: session.sessionFile, sessionId: 'wait', unread: false, createdAt: 1788602400000, outcome: 'success', copy: { title: 'Finished task', body: 'The task is complete.' } }
    mocks.invoke.mockImplementation(async (method: string) => method === 'notifications.inbox' ? { items: [item] } : { ok: true })
    render(<NotificationInbox />)
    fireEvent.click(screen.getByRole('button', { name: 'common:notification.inbox' }))
    await screen.findByText('Finished task')
    expect(document.querySelector('time')).toHaveAttribute('datetime', new Date(item.createdAt).toISOString())
    fireEvent.click(screen.getByRole('button', { name: 'common:notification.markUnread' }))
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith('notifications.markUnread', { id: 'n1', unread: true }))
  })
})
