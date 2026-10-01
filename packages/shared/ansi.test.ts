import { describe, expect, it } from 'vitest'
import { stripAnsi } from './ansi'
import { sessionTreePreview } from './worker-message'

const ESC = '\u001b'

describe('stripAnsi', () => {
  it('should_remove_color_and_cursor_sequences_when_text_has_ansi', () => {
    expect(stripAnsi(`${ESC}[32m✔ parses plain links${ESC}[39m ${ESC}[90m(0.7ms)${ESC}[39m`)).toBe('✔ parses plain links (0.7ms)')
    expect(stripAnsi(`${ESC}[2K${ESC}[1Gdone`)).toBe('done')
    expect(stripAnsi(`${ESC}[1;31mfail${ESC}[0m`)).toBe('fail')
  })

  it('should_remove_osc_hyperlinks_and_keep_their_text', () => {
    expect(stripAnsi(`${ESC}]8;;https://pi.dev${ESC}\\pi${ESC}]8;;${ESC}\\`)).toBe('pi')
    expect(stripAnsi(`${ESC}]8;;https://pi.dev\u0007pi${ESC}]8;;\u0007`)).toBe('pi')
  })

  it('should_return_plain_text_unchanged', () => {
    expect(stripAnsi('plain ✔ 中文 [32m literal')).toBe('plain ✔ 中文 [32m literal')
    expect(stripAnsi('')).toBe('')
  })
})

describe('sessionTreePreview', () => {
  it('should_strip_ansi_trim_and_cap_when_tool_output_is_colored', () => {
    const message = { role: 'toolResult', toolName: 'bash', content: [{ type: 'text', text: `  ${ESC}[32m✔ ok${ESC}[39m\n${'x'.repeat(200)}` }] }
    const preview = sessionTreePreview(message, 20)
    expect(preview).not.toContain(ESC)
    expect(preview.startsWith('✔ ok')).toBe(true)
    expect(preview).toHaveLength(20)
  })
})
