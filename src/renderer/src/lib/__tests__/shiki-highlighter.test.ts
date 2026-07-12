import { describe, expect, it } from 'vitest'
import {
  escapeHtml,
  guessLangFromPath,
  highlightCodeToHtml,
  listSupportedHighlightLangIds,
  resolveLangId,
} from '../shiki-highlighter'

describe('highlightCodeToHtml', () => {
  it('highlights css with a pre block (on-demand grammar)', async () => {
    const code = 'body {\n  margin: 0;\n}\n'
    const html = await highlightCodeToHtml(code, 'css')

    expect(html).toMatch(/<pre[\s>]/i)
    expect(html).toContain('\n')
    expect(html).toMatch(/<code/i)
    expect(html).toContain('<span')
  })

  it('highlights rust on demand', async () => {
    const html = await highlightCodeToHtml('fn main() {\n  println!("hi");\n}\n', 'rs')
    expect(html).toContain('<span')
    expect(html).toMatch(/fn|main/)
  })

  it('maps common path extensions via resolveLangId', () => {
    expect(resolveLangId('ts')).toBe('typescript')
    expect(resolveLangId('tsx')).toBe('tsx')
    expect(resolveLangId('py')).toBe('python')
    expect(resolveLangId('yml')).toBe('yaml')
    expect(resolveLangId('kt')).toBe('kotlin')
    expect(resolveLangId('tf')).toBe('terraform')
  })

  it('guesses language from special filenames', () => {
    expect(guessLangFromPath('Dockerfile')).toBe('docker')
    expect(guessLangFromPath('Makefile')).toBe('makefile')
    expect(guessLangFromPath('.env.local')).toBe('dotenv')
    expect(guessLangFromPath('src/app.tsx')).toBe('tsx')
  })

  it('exposes a large explicit loader set', () => {
    const ids = listSupportedHighlightLangIds()
    expect(ids.length).toBeGreaterThan(80)
    expect(ids).toContain('python')
    expect(ids).toContain('terraform')
    expect(ids).toContain('prisma')
  })

  it('escapeHtml alone does not provide block structure (documents the bug surface)', () => {
    const escaped = escapeHtml('a\nb')
    expect(escaped).toBe('a\nb')
    expect(escaped.includes('<pre')).toBe(false)
  })
})
