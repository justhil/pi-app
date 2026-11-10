import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import {
  Settings,
  Square,
  ThemedIcon,
  applyIconTheme,
} from '@renderer/components/icons'

const THEMES = ['phosphor', 'lucide', 'fluent', 'hugeicons', 'iconoir'] as const

const DIRECTION_GROUPS = [
  ['arrows', ['arrow-down', 'arrow-left', 'arrow-right', 'arrow-up']],
  ['chevrons', ['chevron-down', 'chevron-left', 'chevron-right']],
] as const

for (const theme of THEMES) {
  describe(`${theme} icon theme`, () => {
    afterEach(cleanup)

    it('renders the selected vendor glyph without a wrapper and forwards SVG props', () => {
      applyIconTheme(theme)
      const { container } = render(
        <Settings
          className="h-4 w-4 animate-spin"
          aria-hidden="true"
          data-open="true"
          style={{ color: 'rgb(1, 2, 3)' }}
        />,
      )
      const svg = container.firstElementChild
      expect(svg?.tagName.toLowerCase()).toBe('svg')
      expect(svg).toHaveAttribute('data-icon-theme', theme)
      expect(svg).toHaveClass('h-4', 'w-4', 'animate-spin')
      expect(svg).toHaveAttribute('aria-hidden', 'true')
      expect(svg).toHaveAttribute('data-open', 'true')
      expect(svg).toHaveStyle({ color: 'rgb(1, 2, 3)' })
    })

    it('renders explicit previews independently from the global theme', () => {
      applyIconTheme('lucide')
      const { container } = render(<ThemedIcon theme={theme} name="settings" />)
      expect(container.firstElementChild).toHaveAttribute('data-icon-theme', theme)
    })

    it('preserves the filled stop-square semantic', () => {
      applyIconTheme(theme)
      const { container } = render(<Square className="h-3 w-3 fill-current" strokeWidth={0} />)
      expect(container.firstElementChild).toHaveAttribute('data-icon-filled', 'true')
    })
  })
}

// Opposite directions must not share a glyph. A placeholder mapping that reuses one
// icon for a whole group silently turns a back button into a right arrow.
describe('directional glyphs', () => {
  afterEach(cleanup)

  for (const [label, names] of DIRECTION_GROUPS) {
    for (const theme of THEMES) {
      it(`${theme}: ${label} point in distinct directions`, () => {
        const markup = names.map(
          (name) => render(<ThemedIcon theme={theme} name={name} />).container.innerHTML,
        )
        expect(new Set(markup).size).toBe(names.length)
      })
    }
  }
})
