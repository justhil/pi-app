import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useUIStore } from '@renderer/stores/ui-store'
import { ToolCallRow } from './tool-call-row'
import { buildToolListActivitySummary } from './timeline-turn-activity'
import { collectTouchedPaths } from '../review/review-git-utils'

afterEach(() => cleanup())

beforeEach(() => {
  useUIStore.setState({
    historySessionFile: '/workspace/session.jsonl',
    runState: { status: 'idle', toolCount: 0, errorCount: 0 },
    toolExpandBySession: {},
  })
})

describe('ToolCallRow for codemode', () => {
  it('summarizes nested calls on the collapsed row, strips boilerplate header, and folds script by default when expanded', () => {
    render(
      <ToolCallRow
        item={{
          id: 'cm-1',
          type: 'tool-call',
          toolName: 'codemode',
          toolArgs: {
            code: '// @options: {"timeout_ms": 10000}\nconst a = await tools.read({ path: "src/app.tsx" });\nreturn { ok: true };',
          },
          toolOutput: 'Script completed\nWall time 0.4 seconds\nOutput:\n{"ok":true}',
          toolDetails: {
            calls: [
              { id: 'cm-1/1', name: 'read', args: '{"path":"src/app.tsx"}', status: 'ok', durationMs: 18 },
              { id: 'cm-1/2', name: 'bash', args: '{"command":"npm test"}', status: 'ok', durationMs: 320 },
            ],
          },
          toolPhase: 'end',
          timestamp: 1,
        }}
      />,
    )

    const row = screen.getByRole('button')
    expect(row.textContent).toContain('read app.tsx, bash npm')
    expect(row.textContent).not.toContain('Script completed')

    fireEvent.click(row)
    expect(row).toHaveAttribute('aria-expanded', 'true')
    // Nested calls and stripped output are visible immediately; boilerplate header is stripped
    expect(document.body.textContent).toContain('src/app.tsx')
    expect(document.body.textContent).toContain('npm test')
    expect(document.body.textContent).toContain('"ok": true')
    expect(document.body.textContent).not.toContain('Script completed')
    // Script code drawer is collapsed by default when nested calls exist
    expect(document.body.textContent).not.toContain('timeout_ms')

    // Clicking the script toggle reveals the JS source
    const scriptToggle = screen.getByRole('button', { expanded: false })
    fireEvent.click(scriptToggle)
    expect(document.body.textContent).toContain('timeout_ms')
  })

  it('shows live nested call progress while running', () => {
    render(
      <ToolCallRow
        item={{
          id: 'cm-live',
          type: 'tool-call',
          toolName: 'codemode',
          toolArgs: { code: 'await tools.bash({ command: "vitest" })' },
          toolDetails: {
            calls: [
              { id: 'cm-live/1', name: 'read', args: '{"path":"a.ts"}', status: 'ok', durationMs: 10 },
              { id: 'cm-live/2', name: 'bash', args: '{"command":"vitest run"}', status: 'running' },
            ],
          },
          toolPhase: 'update',
          timestamp: 2,
        }}
      />,
    )
    const row = screen.getByRole('button')
    expect(row.textContent).toContain('1/2 · bash vitest run')
  })

  it('penetrates codemode nested calls into turn activity summary and touched files', () => {
    const tools = [
      {
        id: 'cm-turn',
        type: 'tool-call' as const,
        toolName: 'codemode',
        toolPhase: 'end' as const,
        runId: 'run-1',
        toolArgs: { code: '...' },
        toolDetails: {
          calls: [
            { id: '1', name: 'read', args: '{"path":"src/a.ts"}', status: 'ok' },
            { id: '2', name: 'read', args: '{"path":"src/b.ts"}', status: 'ok' },
            { id: '3', name: 'grep', args: '{"pattern":"foo"}', status: 'ok' },
            { id: '4', name: 'bash', args: '{"command":"npm test"}', status: 'ok' },
            { id: '5', name: 'edit', args: '{"path":"src/edited.ts","edits":[{"oldText":"a","newText":"b"}...', status: 'ok' },
          ],
        },
      },
    ]

    const summary = buildToolListActivitySummary(tools, [], '/workspace')
    expect(summary.exploreCount).toBe(2)
    expect(summary.searchCount).toBe(1)
    expect(summary.commandCount).toBe(1)
    expect(summary.files.map((f) => f.path)).toEqual(['src/edited.ts'])

    const touched = collectTouchedPaths([], tools, 'run-1')
    expect(touched).toEqual(['src/edited.ts'])
  })
})
