import { describe, expect, it } from 'vitest'
import { buildSessionContextPreview } from './session-context-preview'

describe('buildSessionContextPreview', () => {
  it('builds the same scoped preview for live and disk session messages', () => {
    const preview = buildSessionContextPreview({
      sessionId: 'session-a',
      sessionFile: '/sessions/a.jsonl',
      messages: [
        { role: 'user', content: 'hello' },
        { role: 'assistant', content: [{ type: 'text', text: 'world' }] },
        { role: 'toolResult', toolName: 'read', content: 'result' },
        { role: 'compactionSummary', content: 'summary' },
      ],
    })

    expect(preview).toEqual(expect.objectContaining({
      sessionId: 'session-a',
      sessionFile: '/sessions/a.jsonl',
      messageCount: 4,
      estimatedChars: 23,
      roleBreakdown: [
        { role: 'user', chars: 5 },
        { role: 'assistant', chars: 5 },
        { role: 'tool', chars: 6 },
        { role: 'summary', chars: 7 },
      ],
    }))
    expect(preview.segments.map((segment) => segment.role)).toEqual([
      'user',
      'assistant',
      'toolResult',
      'compactionSummary',
    ])
  })

  it('should_strip_ansi_from_display_text_but_count_raw_characters', () => {
    const colored = '\u001b[32m✔ pass\u001b[39m'
    const preview = buildSessionContextPreview({
      sessionFile: '/sessions/a.jsonl',
      messages: [{ role: 'toolResult', toolName: 'bash', content: colored }],
    })
    expect(preview.segments[0].preview).toBe('✔ pass')
    expect(preview.snippets[0]).toBe('[toolResult] ✔ pass')
    expect(preview.segments[0].chars).toBe(colored.length)
  })

  it('should_extract_text_from_system_sections_and_summary_fields_when_building_context_preview', () => {
    const preview = buildSessionContextPreview({
      sessionId: 'session-138',
      sessionFile: '/sessions/issue-138.jsonl',
      messages: [
        {
          role: 'system',
          content: '',
          sections: {
            preamble: 'You are Pi coding agent.',
            rules: 'Always verify with tests.',
          },
        },
        {
          role: 'compactionSummary',
          summary: 'Compacted earlier conversation about browser tabs.',
        },
        {
          role: 'branchSummary',
          summary: 'Branched from main investigation.',
        },
      ],
    })

    const expectedSystem = 'You are Pi coding agent.\n\nAlways verify with tests.'
    const expectedCompaction = 'Compacted earlier conversation about browser tabs.'
    const expectedBranch = 'Branched from main investigation.'

    expect(preview.segments[0]).toEqual(
      expect.objectContaining({
        role: 'system',
        chars: expectedSystem.length,
        preview: expectedSystem,
      }),
    )
    expect(preview.segments[1]).toEqual(
      expect.objectContaining({
        role: 'compactionSummary',
        chars: expectedCompaction.length,
        preview: expectedCompaction,
      }),
    )
    expect(preview.segments[2]).toEqual(
      expect.objectContaining({
        role: 'branchSummary',
        chars: expectedBranch.length,
        preview: expectedBranch,
      }),
    )
    expect(preview.roleBreakdown).toEqual([
      { role: 'system', chars: expectedSystem.length },
      { role: 'summary', chars: expectedCompaction.length + expectedBranch.length },
    ])
  })
})
