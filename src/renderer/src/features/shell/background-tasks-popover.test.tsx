// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { StatusBar } from './status-bar'
import { useUIStore } from '@renderer/stores/ui-store'
import {
  applyBackgroundTasksEvent,
  useBackgroundTasksStore,
} from '@renderer/stores/background-tasks-store'
import {
  applyExtensionStatusEvent,
  useAdapterStatusBarStore,
} from '@renderer/stores/adapter-status-bar-store'
import { useTerminalStore } from '@renderer/features/terminal/terminal-store'
import { stopBackgroundTaskLogFollower } from '@renderer/features/terminal/background-task-terminal'

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }))

vi.mock('@renderer/lib/ipc-client', () => ({
  ipcClient: { invoke: mocks.invoke },
  onAppUpdateAvailable: () => () => {},
  onAppEvent: () => () => {},
}))
vi.mock('@renderer/lib/activate-workspace', () => ({
  activateWorkspace: vi.fn(),
  switchSessionInPlace: vi.fn(),
}))
vi.mock('@renderer/features/git/branch-status', () => ({ BranchStatusTrigger: () => null }))
vi.mock('@renderer/features/terminal/terminal-drawer', () => ({ openTerminalTab: vi.fn() }))

describe('StatusBar background terminal tasks trigger & popover', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    stopBackgroundTaskLogFollower('bg-task:bg_1111aaaa')
    useTerminalStore.setState({ open: false, tabs: [], activeTab: null })
    useBackgroundTasksStore.setState({
      tasksBySession: {},
      activeAdapterBySession: {},
      loading: false,
      lastSyncedAt: 0,
    })
    useAdapterStatusBarStore.setState({ pillsBySession: {} })
    useUIStore.setState({
      currentWorkspace: '/proj',
      historySessionFile: '/sessions/s1.jsonl',
      sessions: [
        {
          sessionId: 's1',
          sessionFile: '/sessions/s1.jsonl',
          title: 'Current chat',
          modelId: '',
          updatedAt: 1,
        },
      ],
      sessionAttention: {},
    })
    mocks.invoke.mockImplementation(async (channel: string) => {
      if (channel === 'desktop.status') return { rss: 0, total: 0, workers: [] }
      if (channel === 'backgroundTasks.list') {
        return {
          tasks: [
            {
              id: 'bg_1111aaaa',
              command: 'npm run package:win',
              status: 'running',
              exitCode: null,
              createdAt: Date.now() - 12_000,
              updatedAt: Date.now(),
              outputPath: 'C:\\Temp\\pi-background-terminal\\bg_1111aaaa.log',
              lineCount: 25,
              tail: 'building electron app...\n',
              timeoutSeconds: 1200,
              sessionFile: '/sessions/s1.jsonl',
            },
          ],
        }
      }
      if (channel === 'backgroundTasks.inspect') {
        return {
          ok: true,
          tail: 'line 1\nline 2\npackaging nsis installer...',
          truncated: false,
          sizeBytes: 42,
        }
      }
      if (channel === 'backgroundTasks.readLog') {
        return {
          ok: true,
          text: 'streamed line\n',
          nextOffset: 14,
          sizeBytes: 14,
          skippedPrefix: false,
        }
      }
      if (channel === 'backgroundTasks.kill') {
        return {
          ok: true,
          task: {
            id: 'bg_1111aaaa',
            command: 'npm run package:win',
            status: 'killed',
            exitCode: null,
            createdAt: Date.now() - 12_000,
            updatedAt: Date.now(),
            lineCount: 25,
            tail: 'stopped',
            sessionFile: '/sessions/s1.jsonl',
          },
        }
      }
      return {}
    })
  })

  afterEach(() => {
    stopBackgroundTaskLogFollower('bg-task:bg_1111aaaa')
    cleanup()
  })

  it('shows live running count, expands popover with live output preview, and stops a running command', async () => {
    applyBackgroundTasksEvent('/sessions/s1.jsonl', [
      {
        id: 'bg_1111aaaa',
        command: 'npm run package:win',
        status: 'running',
        exitCode: null,
        createdAt: Date.now() - 5_000,
        updatedAt: Date.now(),
        outputPath: 'C:\\Temp\\pi-background-terminal\\bg_1111aaaa.log',
        lineCount: 10,
        tail: '',
        timeoutSeconds: 1200,
        sessionFile: '/sessions/s1.jsonl',
      },
    ])

    render(<StatusBar />)
    const trigger = screen.getByTestId('statusbar-bg-tasks-trigger')
    expect(trigger).toHaveTextContent('1')

    // Click to open popover
    fireEvent.click(trigger)
    expect(await screen.findByTestId('bg-task-row-bg_1111aaaa')).toBeInTheDocument()
    expect(screen.getByText('npm run package:win')).toBeInTheDocument()

    // Click task row to expand live log preview
    fireEvent.click(screen.getByText('npm run package:win'))
    expect(await screen.findByText(/packaging nsis installer/)).toBeInTheDocument()
    expect(mocks.invoke).toHaveBeenCalledWith(
      'backgroundTasks.inspect',
      expect.objectContaining({ taskId: 'bg_1111aaaa' }),
    )

    // Click Stop button
    fireEvent.click(screen.getByTestId('bg-task-kill-bg_1111aaaa'))
    await waitFor(() => {
      expect(mocks.invoke).toHaveBeenCalledWith('backgroundTasks.kill', {
        sessionFile: '/sessions/s1.jsonl',
        taskId: 'bg_1111aaaa',
      })
    })

    // Click trigger again to close popover
    fireEvent.click(trigger)
    expect(screen.queryByTestId('bg-task-row-bg_1111aaaa')).not.toBeInTheDocument()
  })

  it('opens and focuses a dedicated built-in terminal tab when clicking the terminal button', async () => {
    applyBackgroundTasksEvent('/sessions/s1.jsonl', [
      {
        id: 'bg_1111aaaa',
        command: 'npm run package:win',
        status: 'running',
        exitCode: null,
        createdAt: Date.now() - 5_000,
        updatedAt: Date.now(),
        outputPath: 'C:\\Temp\\pi-background-terminal\\bg_1111aaaa.log',
        lineCount: 10,
        tail: '',
        timeoutSeconds: 1200,
        sessionFile: '/sessions/s1.jsonl',
      },
    ])

    render(<StatusBar />)
    fireEvent.click(screen.getByTestId('statusbar-bg-tasks-trigger'))
    const openTermBtn = await screen.findByTestId('bg-task-open-terminal-bg_1111aaaa')
    fireEvent.click(openTermBtn)

    // Built-in TerminalDrawer opens on a dedicated tab for this background task and popover closes
    const termState = useTerminalStore.getState()
    expect(termState.open).toBe(true)
    expect(termState.tabs).toHaveLength(1)
    expect(termState.tabs[0].panes[0].ptyId).toBe('bg-task:bg_1111aaaa')
    expect(termState.tabs[0].panes[0].backgroundTask?.taskId).toBe('bg_1111aaaa')
    expect(screen.queryByTestId('bg-task-row-bg_1111aaaa')).not.toBeInTheDocument()

    await waitFor(() => {
      expect(mocks.invoke).toHaveBeenCalledWith(
        'backgroundTasks.readLog',
        expect.objectContaining({
          outputPath: 'C:\\Temp\\pi-background-terminal\\bg_1111aaaa.log',
          offset: 0,
        }),
      )
    })

    // Re-opening from popover focuses the same tab instead of duplicating
    fireEvent.click(screen.getByTestId('statusbar-bg-tasks-trigger'))
    fireEvent.click(await screen.findByTestId('bg-task-open-terminal-bg_1111aaaa'))
    expect(useTerminalStore.getState().tabs).toHaveLength(1)
  })

  it('strictly hides the background trigger when no adapter is active and no tasks exist, and renders status-pill-v1 slots', () => {
    const { rerender } = render(<StatusBar />)
    expect(screen.queryByTestId('statusbar-bg-tasks-trigger')).not.toBeInTheDocument()

    // Active background-jobs-v1 runtime adapter reveals the trigger even with 0 tasks
    applyBackgroundTasksEvent('/sessions/s1.jsonl', [], {
      hasActiveAdapter: true,
      adapterId: '@bytetrue/pi-background-terminal',
      icon: 'Activity',
      title: 'Background Terminal',
    })
    rerender(<StatusBar />)
    expect(screen.getByTestId('statusbar-bg-tasks-trigger')).toBeInTheDocument()

    // status-pill-v1 pill renders and executes declared slash clickAction
    applyExtensionStatusEvent('/sessions/s1.jsonl', {
      type: 'extension_status',
      seq: 1,
      workspaceId: '/proj',
      sessionId: 's1',
      sessionFile: '/sessions/s1.jsonl',
      timestamp: Date.now(),
      phase: 'set',
      adapterId: 'pi-goal-x',
      statusKey: 'goal-progress',
      text: 'Goal 3/5',
      icon: 'Target',
      title: 'Goal',
      clickAction: { type: 'slash', command: '/goal-status' },
    })
    rerender(<StatusBar />)
    const pill = screen.getByTestId('statusbar-pill-goal-progress')
    expect(pill).toHaveTextContent('Goal 3/5')
    fireEvent.click(pill)
    expect(mocks.invoke).toHaveBeenCalledWith('prompt.send', {
      sessionFile: '/sessions/s1.jsonl',
      text: '/goal-status',
    })
  })
})
