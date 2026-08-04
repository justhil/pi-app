import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useUIStore } from '@renderer/stores/ui-store'
import { ProjectSessionTree } from './project-sidebar-rows'

const mocks = vi.hoisted(() => ({
  collectActiveSubagentSessionChildren: vi.fn(),
  openSubagentSessionPreview: vi.fn(),
}))

vi.mock('@renderer/lib/subagent-session-navigation', () => ({
  openSubagentSessionPreview: mocks.openSubagentSessionPreview,
}))

vi.mock('@renderer/lib/subagent-session-activity', () => ({
  collectActiveSubagentSessionChildren: mocks.collectActiveSubagentSessionChildren,
}))

vi.mock('@renderer/features/timeline/tool-card-registry', () => ({
  useToolCardCatalogReady: () => true,
}))

describe('ProjectSessionTree subagent rows', () => {
  beforeEach(() => {
    mocks.collectActiveSubagentSessionChildren.mockReset()
    mocks.collectActiveSubagentSessionChildren.mockReturnValue([])
    mocks.openSubagentSessionPreview.mockReset()
    mocks.openSubagentSessionPreview.mockResolvedValue(undefined)
    useUIStore.setState({
      currentWorkspace: '/workspace',
      currentSessionId: 'child-session',
      historySessionFile: '/sessions/parent/run-1/session.jsonl',
      timelineItems: [],
      sessionRuntimeRunning: {},
      subagentSessionGroup: {
        workspacePath: '/workspace',
        parentSessionId: 'parent-session',
        parentSessionFile: '/sessions/parent.jsonl',
        previewSessionFile: '/sessions/parent/run-1/session.jsonl',
        children: [
          {
            key: 'subagent-call-1:0',
            agent: 'scout',
            task: 'Inspect the project',
            state: 'running',
            sessionFile: '/sessions/parent/run-1/session.jsonl',
          },
        ],
      },
    })
  })

  it('should_turn_the_current_parent_row_into_a_collapsible_menu_when_children_exist', () => {
    mocks.collectActiveSubagentSessionChildren.mockReturnValue([
      {
        key: 'subagent-call-1:0',
        agent: 'scout',
        task: 'Inspect the project',
        state: 'running',
      },
    ])
    useUIStore.setState({
      currentSessionId: 'parent-session',
      historySessionFile: '/sessions/parent.jsonl',
      subagentSessionGroup: null,
      timelineItems: [
        {
          id: 'tool-1',
          type: 'tool-call',
          toolName: 'subagent',
          toolPhase: 'update',
          timestamp: 1,
        },
      ],
    })

    render(
      <ProjectSessionTree
        workspacePath="/workspace"
        projectSessions={[
          {
            sessionId: 'parent-session',
            sessionFile: '/sessions/parent.jsonl',
            title: 'Parent conversation',
            updatedAt: 1,
            modelId: '',
          },
        ]}
        loading={false}
        currentWorkspace="/workspace"
        currentSessionId="parent-session"
        onSessionContextMenu={vi.fn()}
      />,
    )

    expect(screen.getByRole('button', {
      name: 'Toggle subagents for Parent conversation',
    })).toHaveAttribute('aria-expanded', 'false')
  })

  it('should_show_only_running_children_and_keep_the_title_before_the_right_toggle', () => {
    mocks.collectActiveSubagentSessionChildren.mockReturnValue([
      {
        key: 'subagent-call-1:0',
        agent: 'scout',
        task: 'Inspect the project',
        state: 'running',
      },
    ])
    useUIStore.setState({
      currentSessionId: 'parent-session',
      historySessionFile: '/sessions/parent.jsonl',
      subagentSessionGroup: null,
      timelineItems: [
        {
          id: 'tool-1',
          type: 'tool-call',
          toolName: 'subagent',
          toolPhase: 'update',
          timestamp: 1,
        },
      ],
    })

    render(
      <ProjectSessionTree
        workspacePath="/workspace"
        projectSessions={[
          {
            sessionId: 'parent-session',
            sessionFile: '/sessions/parent.jsonl',
            title: 'Parent conversation',
            updatedAt: 1,
            modelId: '',
          },
        ]}
        loading={false}
        currentWorkspace="/workspace"
        currentSessionId="parent-session"
        onSessionContextMenu={vi.fn()}
      />,
    )

    const titleButton = screen.getByRole('button', { name: /^Parent conversation/ })
    const toggle = screen.getByRole('button', {
      name: 'Toggle subagents for Parent conversation',
    })
    expect(titleButton.parentElement?.firstElementChild).toBe(titleButton)

    fireEvent.click(toggle)
    expect(screen.getByText('scout')).toBeInTheDocument()
    expect(screen.queryByText('reviewer')).not.toBeInTheDocument()
  })

  it('should_reclaim_the_toggle_and_expansion_state_when_the_last_child_finishes', async () => {
    mocks.collectActiveSubagentSessionChildren.mockImplementation((items) =>
      items[0]?.toolPhase === 'end'
        ? []
        : [
            {
              key: 'subagent-call-1:0',
              agent: 'scout',
              task: 'Inspect the project',
              state: 'running',
            },
          ],
    )
    useUIStore.setState({
      currentSessionId: 'parent-session',
      historySessionFile: '/sessions/parent.jsonl',
      subagentSessionGroup: null,
      timelineItems: [
        {
          id: 'tool-1',
          type: 'tool-call',
          toolName: 'subagent',
          toolPhase: 'update',
          timestamp: 1,
        },
      ],
    })

    render(
      <ProjectSessionTree
        workspacePath="/workspace"
        projectSessions={[
          {
            sessionId: 'parent-session',
            sessionFile: '/sessions/parent.jsonl',
            title: 'Parent conversation',
            updatedAt: 1,
            modelId: '',
          },
        ]}
        loading={false}
        currentWorkspace="/workspace"
        currentSessionId="parent-session"
        onSessionContextMenu={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', {
      name: 'Toggle subagents for Parent conversation',
    }))

    act(() => {
      useUIStore.setState({
        timelineItems: [
          {
            id: 'tool-1',
            type: 'tool-call',
            toolName: 'subagent',
            toolPhase: 'end',
            timestamp: 1,
          },
        ],
      })
    })
    await waitFor(() => expect(screen.queryByRole('button', {
      name: 'Toggle subagents for Parent conversation',
    })).not.toBeInTheDocument())

    act(() => {
      useUIStore.setState({
        timelineItems: [
          {
            id: 'tool-2',
            type: 'tool-call',
            toolName: 'subagent',
            toolPhase: 'update',
            timestamp: 2,
          },
        ],
      })
    })

    expect(await screen.findByRole('button', {
      name: 'Toggle subagents for Parent conversation',
    })).toHaveAttribute('aria-expanded', 'false')
  })

  it('should_use_the_current_parent_timeline_instead_of_stale_retained_children', () => {
    useUIStore.setState({
      currentSessionId: 'parent-session',
      historySessionFile: '/sessions/parent.jsonl',
      timelineItems: [
        {
          id: 'tool-1',
          type: 'tool-call',
          toolName: 'subagent',
          toolPhase: 'end',
          timestamp: 1,
        },
      ],
    })

    render(
      <ProjectSessionTree
        workspacePath="/workspace"
        projectSessions={[
          {
            sessionId: 'parent-session',
            sessionFile: '/sessions/parent.jsonl',
            title: 'Parent conversation',
            updatedAt: 1,
            modelId: '',
          },
        ]}
        loading={false}
        currentWorkspace="/workspace"
        currentSessionId="parent-session"
        onSessionContextMenu={vi.fn()}
      />,
    )

    expect(screen.queryByRole('button', {
      name: 'Toggle subagents for Parent conversation',
    })).not.toBeInTheDocument()
  })

  it('should_expand_parent_and_select_child_when_subagent_preview_is_open', async () => {
    render(
      <ProjectSessionTree
        workspacePath="/workspace"
        projectSessions={[
          {
            sessionId: 'parent-session',
            sessionFile: '/sessions/parent.jsonl',
            title: 'Parent conversation',
            updatedAt: 1,
            modelId: '',
          },
        ]}
        loading={false}
        currentWorkspace="/workspace"
        currentSessionId="child-session"
        onSessionContextMenu={vi.fn()}
      />,
    )

    const toggle = await screen.findByRole('button', {
      name: 'Toggle subagents for Parent conversation',
    })
    await waitFor(() => expect(toggle).toHaveAttribute('aria-expanded', 'true'))

    const child = screen.getByRole('button', { name: 'Open scout subagent session' })
    expect(child).toHaveClass('nav-row-active')

    fireEvent.click(child)
    expect(mocks.openSubagentSessionPreview).toHaveBeenCalledWith(
      '/sessions/parent/run-1/session.jsonl',
    )
  })
})
