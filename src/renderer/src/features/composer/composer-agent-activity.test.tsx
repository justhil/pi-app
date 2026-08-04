import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useUIStore } from '@renderer/stores/ui-store'
import { ComposerAgentActivity } from './composer-agent-activity'

const mocks = vi.hoisted(() => ({
  openSubagentSessionPreview: vi.fn(),
}))

vi.mock('@renderer/features/timeline/tool-card-registry', () => ({
  resolveToolCardTemplate: (toolName: string | undefined) => toolName === 'subagent' ? 'tree' : undefined,
  useToolCardCatalogReady: () => true,
}))

vi.mock('@renderer/lib/subagent-session-navigation', () => ({
  openSubagentSessionPreview: mocks.openSubagentSessionPreview,
}))

describe('ComposerAgentActivity', () => {
  beforeEach(() => {
    mocks.openSubagentSessionPreview.mockReset()
    mocks.openSubagentSessionPreview.mockResolvedValue(undefined)
    useUIStore.setState({
      currentWorkspace: '/workspace',
      currentSessionId: 'session-1',
      historySessionFile: '/workspace/session-1.jsonl',
      timelineItems: [
        {
          id: 'tool-row-1',
          type: 'tool-call',
          toolCallId: 'subagent-call-1',
          toolName: 'subagent',
          toolPhase: 'update',
          toolDetails: {
            mode: 'single',
            results: [{ agent: 'scout', progress: { status: 'running', toolCount: 2 } }],
          },
          timestamp: 1,
        },
      ],
    })
  })

  function renderActivity() {
    const composerAnchor = document.createElement('div')
    vi.spyOn(composerAnchor, 'getBoundingClientRect').mockReturnValue({
      x: 100,
      y: 500,
      left: 100,
      right: 700,
      top: 500,
      bottom: 620,
      width: 600,
      height: 120,
      toJSON: () => ({}),
    })

    render(
      <ComposerAgentActivity
        composerAnchorRef={{ current: composerAnchor }}
        completionPopoverOpen={false}
      />,
    )
  }

  it('retains final details only while the popover remains open', async () => {
    renderActivity()

    fireEvent.click(screen.getByText('1 Working'))
    expect(await screen.findByRole('dialog', { name: 'Subagents' })).toBeInTheDocument()

    act(() => {
      useUIStore.setState({
        timelineItems: [
          {
            id: 'tool-row-1',
            type: 'tool-call',
            toolCallId: 'subagent-call-1',
            toolName: 'subagent',
            toolPhase: 'end',
            toolDetails: {
              mode: 'single',
              results: [{ agent: 'scout', exitCode: 0 }],
            },
            timestamp: 1,
          },
        ],
      })
    })

    expect(await screen.findByText('Completed', { selector: 'button span' })).toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: 'Subagents' })).toBeInTheDocument()

    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Subagents' })).not.toBeInTheDocument())
    expect(screen.queryByText('Completed', { selector: 'button span' })).not.toBeInTheDocument()
  })

  it('should_keep_popover_inside_viewport_when_launcher_is_not_measured_yet', async () => {
    renderActivity()

    fireEvent.click(screen.getByText('1 Working'))
    const dialog = await screen.findByRole('dialog', { name: 'Subagents' })
    const bottom = Number.parseFloat(dialog.style.bottom)
    const height = Number.parseFloat(dialog.style.height)
    const top = window.innerHeight - bottom - height

    expect(top).toBeGreaterThanOrEqual(12)
  })

  it('should_open_child_session_when_result_row_is_clicked', async () => {
    renderActivity()

    fireEvent.click(screen.getByText('1 Working'))
    expect(await screen.findByRole('dialog', { name: 'Subagents' })).toBeInTheDocument()

    act(() => {
      useUIStore.setState({
        timelineItems: [
          {
            id: 'tool-row-1',
            type: 'tool-call',
            toolCallId: 'subagent-call-1',
            toolName: 'subagent',
            toolPhase: 'end',
            toolDetails: {
              mode: 'single',
              results: [
                {
                  agent: 'scout',
                  exitCode: 0,
                  sessionFile: 'C:\\sessions\\child-session.jsonl',
                },
              ],
            },
            timestamp: 1,
          },
        ],
      })
    })

    fireEvent.click(await screen.findByRole('button', { name: 'Open scout session' }))

    await waitFor(() => expect(mocks.openSubagentSessionPreview).toHaveBeenCalledWith(
      'C:\\sessions\\child-session.jsonl',
    ))
  })
})
