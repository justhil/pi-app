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

  it('nests persisted children under their parent and keeps them collapsed by default', () => {
    useUIStore.setState({ currentSessionId: 'parent-session', historySessionFile: '/sessions/parent.jsonl', subagentSessionGroup: null })
    const { container } = render(<ProjectSessionTree
      workspacePath="/workspace"
      projectSessions={[
        { sessionId: 'child', sessionFile: '/sessions/child.jsonl', parentSessionFile: '/sessions/parent.jsonl', title: 'Finished review', updatedAt: 2, modelId: '' },
        { sessionId: 'parent-session', sessionFile: '/sessions/parent.jsonl', title: 'Parent conversation', updatedAt: 1, modelId: '' },
      ]}
      loading={false} currentWorkspace="/workspace" currentSessionId="parent-session" onSessionContextMenu={vi.fn()}
    />)
    expect(screen.queryByText('Finished review')).not.toBeInTheDocument()
    const toggle = screen.getByRole('button', { name: 'Toggle subagents for Parent conversation' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(toggle).toHaveTextContent('1')
    fireEvent.click(toggle)
    expect(screen.getByText('Finished review')).toBeInTheDocument()
    expect(container.querySelectorAll('.sidebar-session-tree > [data-session-file]')).toHaveLength(1)
    fireEvent.click(toggle)
    expect(screen.queryByText('Finished review')).not.toBeInTheDocument()
  })

  it('preserves ancestors while searching persisted children and resets search-only expansion', () => {
    useUIStore.setState({ historySessionFile: null, subagentSessionGroup: null })
    const props = {
      workspacePath: '/workspace', loading: false, currentWorkspace: '/workspace', currentSessionId: null,
      onSessionContextMenu: vi.fn(), projectSessions: [
        { sessionId: 'parent', sessionFile: '/sessions/parent.jsonl', title: 'Parent', updatedAt: 1, modelId: '' },
        { sessionId: 'child', sessionFile: '/sessions/child.jsonl', parentSessionFile: '/sessions/parent.jsonl', title: 'Child', firstMessage: 'Find the needle', updatedAt: 2, modelId: '' },
        { sessionId: 'unrelated', title: 'Unrelated', updatedAt: 3, modelId: '' },
      ],
    }
    const { rerender } = render(<ProjectSessionTree {...props} searchQuery="needle" />)
    expect(screen.getByText('Parent')).toBeInTheDocument()
    expect(screen.getByText('Child')).toBeInTheDocument()
    expect(screen.queryByText('Unrelated')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Toggle subagents for Parent' })).toHaveAttribute('aria-expanded', 'true')
    rerender(<ProjectSessionTree {...props} searchQuery="" />)
    expect(screen.queryByText('Child')).not.toBeInTheDocument()
    expect(screen.getByText('Unrelated')).toBeInTheDocument()
  })

  it('reveals a selected nested child once without overriding manual collapse on refresh', async () => {
    useUIStore.setState({ historySessionFile: '/sessions/leaf.jsonl', subagentSessionGroup: null })
    const props = {
      workspacePath: '/workspace', loading: false, currentWorkspace: '/workspace', currentSessionId: 'leaf',
      onSessionContextMenu: vi.fn(), projectSessions: [
        { sessionId: 'parent', sessionFile: '/sessions/parent.jsonl', title: 'Parent', updatedAt: 1, modelId: '' },
        { sessionId: 'child', sessionFile: '/sessions/child.jsonl', parentSessionFile: '/sessions/parent.jsonl', title: 'Child', updatedAt: 2, modelId: '' },
        { sessionId: 'leaf', sessionFile: '/sessions/leaf.jsonl', parentSessionFile: '/sessions/child.jsonl', title: 'Leaf', updatedAt: 3, modelId: '' },
      ],
    }
    const { rerender } = render(<ProjectSessionTree {...props} />)
    expect(await screen.findByRole('button', { current: 'page' })).toHaveTextContent('Leaf')
    const toggle = screen.getByRole('button', { name: 'Toggle subagents for Parent' })
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    fireEvent.click(toggle)
    rerender(<ProjectSessionTree {...props} projectSessions={props.projectSessions.map(s => ({ ...s }))} />)
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('Leaf')).not.toBeInTheDocument()
  })

  it('merges persisted and live children into a single expandable row', () => {
    const file = '/sessions/parent/run-1/session.jsonl'
    const { container } = render(<ProjectSessionTree workspacePath="/workspace" loading={false}
      currentWorkspace="/workspace" currentSessionId="child-session" onSessionContextMenu={vi.fn()}
      projectSessions={[
        { sessionId: 'parent-session', sessionFile: '/sessions/parent.jsonl', title: 'Parent', updatedAt: 1, modelId: '' },
        { sessionId: 'child-session', sessionFile: file, parentSessionFile: '/sessions/parent.jsonl', title: 'Recorded scout', updatedAt: 2, modelId: '' },
      ]}
    />)
    expect(screen.getByRole('button', { name: 'Toggle subagents for Parent' })).toHaveTextContent('1')
    expect(container.querySelectorAll(`[data-session-file="${file}"]`)).toHaveLength(1)
    expect(container.querySelectorAll('.sidebar-subagent-row')).toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: /^Recorded scout/ }))
    expect(mocks.openSubagentSessionPreview).toHaveBeenCalledWith(file)
  })

  it('keeps child-list controls valid for session paths containing spaces', () => {
    useUIStore.setState({ historySessionFile: null, subagentSessionGroup: null })
    render(<ProjectSessionTree workspacePath="/workspace" loading={false} currentWorkspace="/workspace" currentSessionId={null}
      onSessionContextMenu={vi.fn()} projectSessions={[
        { sessionId: 'parent', sessionFile: '/session folder/parent.jsonl', title: 'Parent', updatedAt: 1, modelId: '' },
        { sessionId: 'child', sessionFile: '/session folder/child.jsonl', parentSessionFile: '/session folder/parent.jsonl', title: 'Child', updatedAt: 2, modelId: '' },
      ]}
    />)
    const toggle = screen.getByRole('button', { name: 'Toggle subagents for Parent' })
    fireEvent.click(toggle)
    const id = toggle.getAttribute('aria-controls')!
    expect(id).not.toMatch(/\s/)
    expect(document.getElementById(id)).toContainElement(screen.getByText('Child'))
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
