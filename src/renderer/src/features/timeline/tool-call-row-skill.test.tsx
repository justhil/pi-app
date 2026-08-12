import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useUIStore } from '@renderer/stores/ui-store'
import type { ToolTimelineItem } from '@renderer/stores/ui-store-types'
import { ToolCallRow } from './tool-call-row'

afterEach(() => cleanup())

beforeEach(() => {
  useUIStore.setState({
    historySessionFile: '/workspace/session.jsonl',
    runState: { status: 'idle', toolCount: 0, errorCount: 0 },
    toolExpandBySession: {},
  })
})

function renderRow(item: ToolTimelineItem) {
  render(<ToolCallRow item={item} />)
}

describe('ToolCallRow Skill context semantics', () => {
  it('renders SKILL.md reads as Skill context and keeps the read preview expandable', () => {
    renderRow({
      id: 'skill-read',
      type: 'tool-call',
      toolName: 'read',
      toolArgs: { path: 'C:\\Users\\dev\\.pi\\agent\\skills\\frontend-taste\\SKILL.md' },
      toolOutput: '# Frontend Taste',
      toolPhase: 'end',
      timestamp: 1,
    })

    const row = screen.getByRole('button', { name: /Loaded Skill context · frontend-taste/i })
    expect(row.querySelector('svg.text-primary\\/75')).toBeTruthy()
    expect(row.querySelector('svg.timeline-text-quiet')).toBeNull()
    expect(row).not.toHaveTextContent(/Read C:/i)

    fireEvent.click(row)
    expect(row).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('# Frontend Taste')).toBeTruthy()
  })

  it('keeps ordinary read calls on the normal tool presentation', () => {
    renderRow({
      id: 'normal-read',
      type: 'tool-call',
      toolName: 'read',
      toolArgs: { path: '/repo/README.md' },
      toolOutput: '# Repo',
      toolPhase: 'end',
      timestamp: 1,
    })

    const row = screen.getByRole('button', { name: /Read \/repo\/README\.md/i })
    expect(row.querySelector('svg.timeline-text-quiet')).toBeTruthy()
    expect(row.querySelector('svg.text-primary\\/75')).toBeNull()
    expect(row).not.toHaveTextContent(/Skill context/i)
  })
})
