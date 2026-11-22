// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useState } from 'react'
import {
  DEFAULT_UI_CUSTOMIZATION,
  normalizeComposerToolbarOrder,
  normalizeUiCustomization,
  type UiCustomization,
} from '@shared/ui-customization'
import {
  applyUiCustomizationToDocument,
  highlightPiSlot,
} from '@renderer/lib/theme/apply-ui-customization'
import {
  WorkbenchComposerControls,
  WorkbenchCssInspectorControls,
  WorkbenchReadingControls,
  reorderToolbarItems,
} from '../workbench-customizer-controls'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string) => k,
  }),
}))

afterEach(() => {
  cleanup()
  highlightPiSlot(null)
  document.getElementById('pi-ui-customization-vars')?.remove()
  for (const attr of [
    'data-mid-prose-style',
    'data-composer-preset',
    'data-composer-purge',
    'data-composer-metrics',
  ]) {
    document.documentElement.removeAttribute(attr)
  }
})

describe('ui-customization schema & DOM applier', () => {
  it('normalizes partial toolbar order without losing or duplicating slots', () => {
    expect(normalizeComposerToolbarOrder(['model', 'spacer', 'model', 'invalid'])).toEqual([
      'model',
      'spacer',
      'attach',
      'tools',
      'purge',
      'metrics',
    ])
  })

  it('clamps numeric bounds and syncs <html> data attributes + CSS variables', () => {
    const cfg = normalizeUiCustomization({
      midTurnProseStyle: 'rail',
      chatFontSize: 16,
      chatLineHeight: 1.72,
      chatColumnMax: 920,
      composerPreset: 'zen',
      composerMaxHeight: 200,
      composerPurgeMode: 'icon',
      composerMetricsMode: 'pill',
      composerContextPosition: 'statusbar',
      composerContextStyle: 'pill',
      composerContextSwapped: true,
      composerWorktreeMode: 'icon',
      composerBranchMode: 'compact',
    })
    applyUiCustomizationToDocument(cfg)

    expect(document.documentElement.getAttribute('data-mid-prose-style')).toBe('rail')
    expect(document.documentElement.getAttribute('data-composer-context-position')).toBe('statusbar')
    expect(document.documentElement.getAttribute('data-composer-context-style')).toBe('pill')
    expect(document.documentElement.getAttribute('data-composer-context-swapped')).toBe('swapped')
    expect(document.documentElement.getAttribute('data-composer-worktree')).toBe('icon')
    expect(document.documentElement.getAttribute('data-composer-branch')).toBe('compact')
    expect(document.documentElement.getAttribute('data-composer-preset')).toBe('zen')
    expect(document.documentElement.getAttribute('data-composer-purge')).toBe('icon')
    expect(document.documentElement.getAttribute('data-composer-metrics')).toBe('pill')

    const css = document.getElementById('pi-ui-customization-vars')?.textContent ?? ''
    expect(css).toContain('--chat-font-size: 16px;')
    expect(css).toContain('--composer-max-height: 200px;')
    expect(css).toContain('--chat-content-cap: 920px;')
  })

  it('spotlights matching [data-pi-slot] elements on hover and clears cleanly', () => {
    const dummy = document.createElement('button')
    dummy.setAttribute('data-pi-slot', 'composer-purge-btn')
    document.body.appendChild(dummy)

    highlightPiSlot('composer-purge-btn')
    expect(dummy.getAttribute('data-pi-slot-highlight')).toBe('true')

    highlightPiSlot(null)
    expect(dummy.hasAttribute('data-pi-slot-highlight')).toBe(false)
    dummy.remove()
  })
})

describe('Interactive Workbench Controls', () => {
  it('reorders composer toolbar items via move buttons and drag-drop helper, and switches mid-prose style', () => {
    expect(reorderToolbarItems(['attach', 'tools', 'spacer', 'model', 'purge', 'metrics'], 3, 0)).toEqual([
      'model',
      'attach',
      'tools',
      'spacer',
      'purge',
      'metrics',
    ])

    let latest: UiCustomization = DEFAULT_UI_CUSTOMIZATION
    function Harness() {
      const [ui, setUi] = useState<UiCustomization>(DEFAULT_UI_CUSTOMIZATION)
      return (
        <div>
          <WorkbenchReadingControls
            userMessageStyle="bubble"
            onUserMessageStyleChange={() => {}}
            ui={ui}
            onUiChange={(p) => {
              const next = normalizeUiCustomization({ ...ui, ...p })
              latest = next
              setUi(next)
            }}
          />
          <WorkbenchComposerControls
            ui={ui}
            onUiChange={(p) => {
              const next = normalizeUiCustomization({ ...ui, ...p })
              latest = next
              setUi(next)
            }}
          />
        </div>
      )
    }

    render(<Harness />)

    // Switch mid-turn prose style to 'muted'
    fireEvent.click(screen.getByRole('button', { name: 'settings:appearance.workbench.midProse.muted' }))
    expect(latest.midTurnProseStyle).toBe('muted')

    // Move 'model' left across 'spacer'
    const moveModelLeft = screen.getByRole('button', {
      name: 'settings:appearance.workbench.moveUp: model',
    })
    fireEvent.click(moveModelLeft)
    expect(latest.composerToolbarOrder.indexOf('model')).toBeLessThan(
      latest.composerToolbarOrder.indexOf('spacer'),
    )
  })

  it('inserts CSS recipes and [data-pi-slot] selectors on click', () => {
    let cssState = { enabled: false, css: '' }
    render(
      <WorkbenchCssInspectorControls
        customCss={cssState}
        onCustomCssChange={(next) => {
          cssState = next
        }}
      />,
    )

    fireEvent.click(screen.getByText('settings:appearance.workbench.recipes.pillSend'))
    expect(cssState.enabled).toBe(true)
    expect(cssState.css).toContain('[data-pi-slot="composer-send-btn"]')

    fireEvent.click(screen.getByText('composer-purge-btn'))
    expect(cssState.css).toContain('[data-pi-slot="composer-purge-btn"]')
  })
})
