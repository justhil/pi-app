import { describe, expect, it } from 'vitest'
import {
  isRightPanelHidden,
  nextRightPanelToggle,
  revealRightPanelPatch,
} from './right-panel-visibility'

describe('right panel visibility', () => {
  it('should_hide_on_narrow_window_until_user_expands', () => {
    expect(
      isRightPanelHidden({ collapsed: false, expandedOnNarrow: false, windowWidth: 900 }),
    ).toBe(true)
    expect(
      isRightPanelHidden({ collapsed: false, expandedOnNarrow: true, windowWidth: 900 }),
    ).toBe(false)
    expect(
      isRightPanelHidden({ collapsed: false, expandedOnNarrow: false, windowWidth: 1400 }),
    ).toBe(false)
  })

  it('should_remember_narrow_expand_after_toggle', () => {
    expect(nextRightPanelToggle({ hidden: true, windowWidth: 900 })).toEqual({
      rightPanelCollapsed: false,
      rightPanelExpandedOnNarrow: true,
    })
    expect(nextRightPanelToggle({ hidden: false, windowWidth: 900 })).toEqual({
      rightPanelCollapsed: true,
      rightPanelExpandedOnNarrow: false,
    })
  })

  it('should_reveal_and_remember_on_narrow', () => {
    expect(revealRightPanelPatch(980)).toEqual({
      rightPanelCollapsed: false,
      rightPanelExpandedOnNarrow: true,
    })
  })
})
