import { describe, expect, it } from 'vitest'
import {
  CORE_RIGHT_PANEL_CATALOG,
  defaultCoreRightPanelPrefs,
  firstEnabledPanel,
  normalizeRightPanelPrefs,
} from './right-panels'

describe('defaultCoreRightPanelPrefs', () => {
  it('enables only files and run by default', () => {
    const prefs = defaultCoreRightPanelPrefs()
    expect(prefs.files).toBe(true)
    expect(prefs.run).toBe(true)
    expect(prefs.review).toBe(false)
    expect(prefs.context).toBe(false)
    expect(prefs.tree).toBe(false)
  })
})

describe('CORE_RIGHT_PANEL_CATALOG tree icon', () => {
  it('uses ListTree for tree and GitBranch for review', () => {
    const tree = CORE_RIGHT_PANEL_CATALOG.find((item) => item.id === 'tree')
    const review = CORE_RIGHT_PANEL_CATALOG.find((item) => item.id === 'review')
    expect(tree?.icon).toBe('ListTree')
    expect(review?.icon).toBe('GitBranch')
  })
})

describe('normalizeRightPanelPrefs', () => {
  it('falls back to files+run when all panels disabled', () => {
    const prefs = normalizeRightPanelPrefs(
      { review: false, run: false, context: false, tree: false, files: false },
      CORE_RIGHT_PANEL_CATALOG,
    )
    expect(prefs.files).toBe(true)
    expect(prefs.run).toBe(true)
  })

  it('firstEnabledPanel prefers enabled core panels', () => {
    const prefs = defaultCoreRightPanelPrefs()
    expect(firstEnabledPanel(prefs, CORE_RIGHT_PANEL_CATALOG)).toBe('run')
  })
})
