// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useExtensionUIStore } from '@renderer/stores/extension-ui-store'
import { useUIStore } from '@renderer/stores/ui-store'
import { ExtensionUIHost } from '../extension-ui-host'
import { SuspendedExtensionDialogPill } from '../suspended-dialog-pill'
import { SessionRunningPixelGrid } from '@renderer/features/workspace/session-running-pixel-grid'

const invokeMock = vi.fn<(...args: unknown[]) => Promise<unknown>>(async () => ({}))
vi.mock('@renderer/lib/ipc-client', () => ({
  ipcClient: { invoke: (...args: unknown[]) => invokeMock(...args) },
}))

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-i18next')>()
  return {
    ...actual,
    useTranslation: () => ({
      t: (k: string) => k,
    }),
  }
})

afterEach(() => {
  cleanup()
  invokeMock.mockClear()
  useExtensionUIStore.getState().clearAllDialogs()
  useUIStore.setState({ timelineItems: [], historySessionFile: null })
})

describe('ExtensionUIStore FIFO queue & dialog polish', () => {
  it('queues concurrent dialogs FIFO instead of clobbering the active dialog', () => {
    const store = useExtensionUIStore.getState()
    store.enqueuePending({ id: 'req-1', method: 'select', title: 'First', options: ['A'] })
    store.enqueuePending({ id: 'req-2', method: 'select', title: 'Second', options: ['B'] })

    expect(useExtensionUIStore.getState().activePending?.id).toBe('req-1')
    expect(useExtensionUIStore.getState().pendingQueue.map((q) => q.id)).toEqual(['req-2'])

    useExtensionUIStore.getState().clearAfterRespond()
    expect(useExtensionUIStore.getState().activePending?.id).toBe('req-2')
    expect(useExtensionUIStore.getState().pendingQueue).toEqual([])
  })

  it('localizes pi-rewind Restore Options, sends raw option values, and cancels directly on Escape when no tool row backs it', () => {
    useExtensionUIStore.getState().enqueuePending({
      id: 'rewind-1',
      method: 'select',
      title: 'Restore Options',
      options: ['Keep current files', 'Restore files to that point', 'Cancel navigation'],
    })

    render(<ExtensionUIHost />)
    expect(screen.getByText('extension:rewindPrompt.title')).toBeInTheDocument()
    expect(screen.getByText('extension:rewindPrompt.keepFiles')).toBeInTheDocument()
    expect(screen.getByText('extension:rewindPrompt.restoreFiles')).toBeInTheDocument()

    // Pressing Escape on a non-tool-backed select cancels directly instead of stranding the worker
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(invokeMock).toHaveBeenCalledWith('extension.respondUI', {
      id: 'rewind-1',
      cancelled: true,
    })
    expect(useExtensionUIStore.getState().suspended).toBeNull()
    expect(useExtensionUIStore.getState().activePending).toBeNull()
  })

  it('supports arrow navigation + Enter selection and sends exact raw option value to extension', () => {
    useExtensionUIStore.getState().enqueuePending({
      id: 'rewind-2',
      method: 'select',
      title: 'Restore Options',
      options: ['Keep current files', 'Restore files to that point'],
    })

    render(<ExtensionUIHost />)
    fireEvent.keyDown(window, { key: 'ArrowDown' })
    fireEvent.keyDown(window, { key: 'Enter' })

    expect(invokeMock).toHaveBeenCalledWith('extension.respondUI', {
      id: 'rewind-2',
      value: 'Restore files to that point',
    })
  })

  it('shows SuspendedExtensionDialogPill above Composer and resumes on click', () => {
    useUIStore.setState({ historySessionFile: '/proj/s1.jsonl' })
    useExtensionUIStore.getState().enqueuePending({
      id: 'q-1',
      method: 'ask_user_question',
      sessionFile: '/proj/s1.jsonl',
      questions: [{ question: 'Pick a framework?', header: 'Framework', options: [{ label: 'React' }] }],
    })
    useExtensionUIStore.getState().suspendActive({})

    render(<SuspendedExtensionDialogPill />)
    const pillBtn = screen.getByRole('button', { name: /Framework/ })
    fireEvent.click(pillBtn)

    expect(useExtensionUIStore.getState().activePending?.id).toBe('q-1')
    expect(useExtensionUIStore.getState().suspended).toBeNull()
  })

  it('renders transparent-bg organic 3x3 SessionRunningPixelGrid with lead/mid/tail trail classes', () => {
    const { container } = render(<SessionRunningPixelGrid title="Running" />)
    const cells = container.querySelectorAll('.session-running-pixel')
    const lit = container.querySelectorAll('.session-running-pixel--on')
    expect(cells.length).toBe(9)
    expect(lit.length).toBe(4)
    expect(container.querySelectorAll('.session-running-pixel--lead').length).toBe(1)
  })
})
