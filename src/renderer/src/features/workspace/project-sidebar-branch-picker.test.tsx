// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ProjectDiskRow } from './project-sidebar-rows'

const invokeMock = vi.fn<(...args: unknown[]) => Promise<unknown>>()
const activateWorkspaceMock = vi.fn<(...args: unknown[]) => Promise<void>>(async () => {})

vi.mock('@renderer/lib/ipc-client', () => ({
  ipcClient: { invoke: (...args: unknown[]) => invokeMock(...args) },
}))

vi.mock('@renderer/lib/activate-workspace', () => ({
  activateWorkspace: (...args: unknown[]) => activateWorkspaceMock(...args),
}))

afterEach(() => {
  cleanup()
  invokeMock.mockReset()
  activateWorkspaceMock.mockReset()
})

describe('Left Sidebar ProjectDiskRow ghost branch switcher', () => {
  it('opens branch popover without toggling project, switches branch, and jumps to worktree branch', async () => {
    invokeMock.mockImplementation(async (channel: unknown) => {
      if (channel === 'git.branches') {
        return {
          branches: [
            { name: '1', remote: false, head: 'ac74814', date: 1, upstream: null, current: true, worktree: '/repo' },
            { name: 'main', remote: false, head: '025acfa', date: 2, upstream: 'origin/main', current: false, worktree: null },
            { name: 'feat-ui', remote: false, head: 'deadbee', date: 3, upstream: null, current: false, worktree: '/repo-wt' },
          ],
        }
      }
      if (channel === 'git.switchBranch') return { ok: true, branch: 'main', stashed: false }
      return {}
    })

    const onOpenProject = vi.fn()
    const onBranchSwitched = vi.fn()

    render(
      <ProjectDiskRow
        path="/repo"
        name="pi-app"
        branch="1"
        active
        open={false}
        onToggleOpen={vi.fn()}
        onOpenProject={onOpenProject}
        onNewSession={vi.fn()}
        onProjectContextMenu={vi.fn()}
        onBranchSwitched={onBranchSwitched}
        sessionTree={null}
      />,
    )

    const trigger = screen.getByTestId('sidebar-branch-trigger')
    expect(trigger).toHaveTextContent('1')
    // Zero git.branches IPC fired until the user clicks the ghost branch trigger!
    expect(invokeMock).not.toHaveBeenCalled()

    fireEvent.click(trigger)
    expect(onOpenProject).not.toHaveBeenCalled()

    const mainOpt = await screen.findByRole('option', { name: /main/ })
    fireEvent.click(mainOpt)
    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('git.switchBranch', {
        cwd: '/repo',
        name: 'main',
        remote: false,
      })
      expect(onBranchSwitched).toHaveBeenCalled()
    })

    // Re-open and click the branch checked out in another Worktree -> jumps directly to that Worktree!
    fireEvent.click(trigger)
    const wtOpt = await screen.findByRole('option', { name: /feat-ui/ })
    fireEvent.click(wtOpt)
    await waitFor(() => {
      expect(activateWorkspaceMock).toHaveBeenCalledWith('/repo-wt')
    })
  })
})
