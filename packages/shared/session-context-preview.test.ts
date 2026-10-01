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
})
