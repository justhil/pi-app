// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { applyCustomTheme } from '../inject-theme'
import { injectCssSnippets } from '../render-fx-engine'

describe('render-fx-engine DOM synchronization', () => {
  afterEach(() => {
    document.documentElement.classList.remove('dark')
    applyCustomTheme({})
    injectCssSnippets([])
  })

  it('should_sync_data_attributes_and_switch_cleanly_between_light_and_dark_variants', () => {
    applyCustomTheme({
      light: {
        preset: null,
        accent: '#e06824',
        surface: '#fafaf8',
        ink: '#0b0d0b',
        contrast: 46,
        fontUi: null,
        fontCode: null,
        translucentSidebar: false,
        frameStyle: 'flat',
        messageStyle: 'editorial',
        density: 'compact',
        accentPresence: 'balanced',
        surfaceMaterial: 'bevel',
        backdropPreset: 'dots',
      },
      dark: {
        preset: null,
        accent: '#38bdf8',
        surface: '#0f172a',
        ink: '#f8fafc',
        contrast: 60,
        fontUi: null,
        fontCode: null,
        translucentSidebar: true,
        frameStyle: 'island',
        messageStyle: 'card',
        surfaceMaterial: 'liquid-glass',
        glassDispersion: true,
        backdropPreset: 'ambient',
      },
    })

    const root = document.documentElement
    expect(root.getAttribute('data-frame-style')).toBe('flat')
    expect(root.getAttribute('data-msg-style')).toBe('editorial')
    expect(root.getAttribute('data-surface-material')).toBe('bevel')
    expect(root.getAttribute('data-backdrop-preset')).toBe('dots')
    expect(document.getElementById('pi-fx-backdrop')).not.toBeNull()

    // Switch to dark -> MutationObserver / sync updates to island + liquid-glass!
    root.classList.add('dark')
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        expect(root.getAttribute('data-frame-style')).toBe('island')
        expect(root.getAttribute('data-msg-style')).toBe('card')
        expect(root.getAttribute('data-surface-material')).toBe('liquid-glass')
        expect(root.getAttribute('data-glass-dispersion')).toBe('on')
        expect(root.getAttribute('data-backdrop-preset')).toBe('ambient')
        resolve()
      }, 10)
    })
  })
})
