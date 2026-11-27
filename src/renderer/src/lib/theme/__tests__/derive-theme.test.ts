import { describe, expect, it } from 'vitest'
import type { ThemeVariant } from '@shared/custom-theme'
import { deriveThemeVariables } from '../derive-theme'
import { generateThemeCss } from '../generate-theme-css'

const HSL_TRIPLET_RE = /^\d+(?:\.\d+)? \d+(?:\.\d+)?% \d+(?:\.\d+)?%$/

const VSCODE_PLUS: ThemeVariant = {
  preset: 'vscode-plus',
  accent: '#007acc',
  surface: '#ffffff',
  ink: '#000000',
  contrast: 45,
  fontUi: null,
  fontCode: null,
  translucentSidebar: true,
  diffAdded: '#008000',
  diffRemoved: '#ee0000',
}

const CODEX_DARK: ThemeVariant = {
  preset: 'codex-dark',
  accent: '#339cff',
  surface: '#181818',
  ink: '#ffffff',
  contrast: 60,
  fontUi: null,
  fontCode: null,
  translucentSidebar: false,
}

describe('custom theme derivation', () => {
  it('emits bare HSL triplets for every shadcn variable', () => {
    const hslVariables = deriveThemeVariables(VSCODE_PLUS).filter(
      (variable) => variable.format === 'hsl-triplet',
    )

    expect(hslVariables.length).toBeGreaterThan(0)
    for (const variable of hslVariables) expect(variable.value).toMatch(HSL_TRIPLET_RE)
  })

  it('returns no CSS when neither variant is customized', () => {
    expect(generateThemeCss({})).toBe('')
  })

  it.each([
    ['light', { light: VSCODE_PLUS }, ':root:not(.dark)', ':root.dark'],
    ['dark', { dark: CODEX_DARK }, ':root.dark', ':root:not(.dark)'],
  ] as const)(
    'keeps selectors mutually exclusive and emits the default-side block for a %s-only theme',
    (_variant, theme, customizedSelector, defaultSelector) => {
      const css = generateThemeCss(theme)

      expect(css).toContain(`${customizedSelector} {\n`)
      expect(css).toContain(`${defaultSelector} {}`)
      expect(css).not.toMatch(/(?:^|\n):root\s*\{/)
      expect(css.indexOf(':root:not(.dark)')).toBeLessThan(css.indexOf(':root.dark'))
    },
  )

  it('keeps the VS Code Plus calibration stable', () => {
    const values = Object.fromEntries(
      deriveThemeVariables(VSCODE_PLUS).map(({ name, value, format }) => [name, { value, format }]),
    )

    expect(values).toMatchObject({
      '--bg-base': { value: '#ffffff', format: 'hex' },
      '--bg-1': { value: '#f5f5f5', format: 'hex' },
      '--bg-2': { value: '#ececec', format: 'hex' },
      '--bg-3': { value: '#dfdfdf', format: 'hex' },
      '--bg-hover': { value: '#f1f1f1', format: 'hex' },
      '--bg-active': { value: '#e2e2e2', format: 'hex' },
      '--border-base': { value: '#dcdcdc', format: 'hex' },
      '--text-secondary': { value: '#434343', format: 'hex' },
      '--brand': { value: '#007acc', format: 'hex' },
      '--brand-hover': { value: '#005c9c', format: 'hex' },
      '--brand-light': { value: '#e5effa', format: 'hex' },
      '--focus-border': { value: '#9dc4eb', format: 'hex' },
      '--surface-sidebar': { value: '#f0f0f0b8', format: 'hex' },
      '--diff-added': { value: '#008000', format: 'hex' },
      '--diff-removed': { value: '#ee0000', format: 'hex' },
      '--background': { value: '0 0% 100%', format: 'hsl-triplet' },
      '--foreground': { value: '0 0% 0%', format: 'hsl-triplet' },
      '--muted': { value: '0 0% 92.5%', format: 'hsl-triplet' },
      '--muted-foreground': { value: '0 0% 26.3%', format: 'hsl-triplet' },
      '--ring': { value: '204.1 100% 40%', format: 'hsl-triplet' },
      '--surface-frame': { value: '#f0f0f0b8', format: 'hex' },
    })
  })

  it('derives --surface-frame override and --shell-hairline cleanly', () => {
    const vars = Object.fromEntries(
      deriveThemeVariables({
        ...CODEX_DARK,
        colors: { frame: '#111215', border: '#2a2d34' },
      }).map(({ name, value }) => [name, value]),
    )
    expect(vars['--surface-frame']).toBe('#111215')
    expect(vars['--shell-hairline']).toBe('#2a2d3485')
  })
})
