import { beforeEach, describe, expect, it, vi } from 'vitest'
import { applyThemeToDocument, type ThemeChoice } from '../settings-draft'

describe('applyThemeToDocument', () => {
  beforeEach(() => {
    document.documentElement.classList.remove('dark')
    vi.stubGlobal(
      'matchMedia',
      vi.fn().mockImplementation((query: string) => ({
        matches: query.includes('prefers-color-scheme: dark') ? false : false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    )
  })

  it('should_add_dark_class_when_theme_is_dark', () => {
    applyThemeToDocument('dark')
    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })

  it('should_remove_dark_class_when_theme_is_light', () => {
    document.documentElement.classList.add('dark')
    applyThemeToDocument('light')
    expect(document.documentElement.classList.contains('dark')).toBe(false)
  })

  it('should_follow_system_pref_when_theme_is_system', () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn().mockImplementation((query: string) => ({
        matches: query.includes('prefers-color-scheme: dark'),
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    )
    applyThemeToDocument('system' satisfies ThemeChoice)
    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })
})
