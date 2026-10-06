import { describe, expect, it } from 'vitest'
import { normalizeThemeVariant } from '@shared/custom-theme'
import { deriveThemeVariables } from '../derive-theme'
import { exportThemeString, parseThemeString } from '../parse-theme-string'
import { THEME_PRESETS, presetVariant } from '../presets'
import { themeContrastRatio } from '@renderer/features/settings/appearance-theme-editor'

const vars = (v: Parameters<typeof deriveThemeVariables>[0]) => Object.fromEntries(deriveThemeVariables(v).map((x) => [x.name, x.value]))

describe('theme extras', () => {
  it('normalizes optional fields and drops invalid ones', () => {
    const v = normalizeThemeVariant({ accent: '#c96442', surface: '#faf9f5', ink: '#141413', colors: { sidebar: '#F3F1EA', chat: 'red', bogus: '#000' }, fontDisplay: 'serif', proseFont: 'x', chatFontSize: 40, chatLineHeight: '1.567', radius: -3, shadow: 30 }, 'light')
    expect(v).toMatchObject({ colors: { sidebar: '#f3f1ea' }, fontDisplay: 'serif', chatFontSize: 18, chatLineHeight: 1.57, radius: 0, shadow: 30 })
    expect(v?.proseFont).toBeUndefined()
    // A v1 theme stays exactly as it was.
    expect(normalizeThemeVariant({ accent: '#000000', surface: '#ffffff', ink: '#000000' }, 'light')).not.toHaveProperty('colors')
  })

  it('emits overrides only for what is set', () => {
    const plain = vars(presetVariant('vscode-plus', 'light')!)
    expect(plain['--chat-bg']).toBeUndefined()
    expect(plain['--radius']).toBeUndefined()
    const claude = vars(presetVariant('claude', 'light')!)
    expect(claude['--surface-sidebar']).toBe('#f3f1ea')
    expect(claude['--message-user-bg']).toBe('#f0eee6')
    expect(claude['--code-bg']).toBe('#f5f4ee')
    expect(claude['--border-base']).toBe('#e3e0d5')
    expect(claude['--font-display']).toBe('var(--font-serif-base)')
    expect(claude['--prose-font']).toBe('var(--font-display)')
    expect(claude['--chat-font-size']).toBe('16px')
    expect(claude['--radius']).toBe('10px')
    expect(claude['--main-chat-surface-radius']).toBe('16px')
    expect(claude['--main-chat-surface-shadow-top']).toContain('rgba(18, 24, 40, 0.060)')
    expect(vars(presetVariant('claude', 'dark')!)['--main-chat-surface-shadow-top']).toContain('rgba(0, 0, 0')
  })

  it('round-trips extras through the theme string', () => {
    const v = presetVariant('claude', 'dark')!
    const parsed = parseThemeString(exportThemeString(v, 'dark'))
    expect(parsed.ignoredFieldCount).toBe(0)
    expect(parsed.themeVariant).toMatchObject({ colors: v.colors, fontDisplay: 'serif', proseFont: 'display', chatFontSize: 16, radius: 10, shadow: 40 })
  })

  it('every preset keeps body text readable', () => {
    for (const p of THEME_PRESETS) {
      for (const v of [p.light, p.dark]) {
        if (!v) continue
        expect(themeContrastRatio(v.ink, v.surface), `${p.id}`).toBeGreaterThanOrEqual(7)
        if (v.colors?.userBubble) expect(themeContrastRatio(v.ink, v.colors.userBubble)).toBeGreaterThanOrEqual(7)
        if (v.colors?.sidebar) expect(themeContrastRatio(v.ink, v.colors.sidebar)).toBeGreaterThanOrEqual(7)
      }
    }
  })
})
