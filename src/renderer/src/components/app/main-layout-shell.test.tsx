import { act, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { MainLayoutShell } from './main-layout-shell'
import { useUIStore } from '@renderer/stores/ui-store'

const DEFAULTS = {
  sidebarWidth: 260,
  sidebarCollapsed: false,
  rightPanelWidth: 288,
  rightPanelCollapsed: false,
}

beforeEach(() => {
  useUIStore.setState(DEFAULTS)
})

afterEach(() => {
  useUIStore.setState(DEFAULTS)
})

function resizeWindow(width: number) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width })
  act(() => {
    window.dispatchEvent(new Event('resize'))
  })
}

describe('MainLayoutShell window-resize adaptation', () => {
  it('clamps both panels when the window shrinks so the center column keeps a gap', () => {
    render(<MainLayoutShell left={<div />} center={<div />} right={<div />} />)
    useUIStore.setState({ sidebarWidth: 360, rightPanelWidth: 500 })

    resizeWindow(700)

    const s = useUIStore.getState()
    // Sidebar capped at 40% of the window.
    expect(s.sidebarWidth).toBe(280)
    // Right panel capped so the center keeps 120px: 700 - 280 - 120 = 300.
    expect(s.rightPanelWidth).toBe(300)
  })

  it('keeps panel widths when the window grows', () => {
    render(<MainLayoutShell left={<div />} center={<div />} right={<div />} />)
    useUIStore.setState({ sidebarWidth: 260, rightPanelWidth: 288 })

    resizeWindow(1800)

    const s = useUIStore.getState()
    expect(s.sidebarWidth).toBe(260)
    expect(s.rightPanelWidth).toBe(288)
  })

  it('does not touch the sidebar width while it is collapsed', () => {
    render(<MainLayoutShell left={<div />} center={<div />} right={<div />} />)
    useUIStore.setState({ sidebarWidth: 360, sidebarCollapsed: true, rightPanelWidth: 500 })

    resizeWindow(700)

    const s = useUIStore.getState()
    expect(s.sidebarWidth).toBe(360)
    // Right clamp accounts for the 40px collapsed rail: 700 - 40 - 120 = 540 fits 500.
    expect(s.rightPanelWidth).toBe(500)
  })

  it('adapts persisted oversized widths on mount', () => {
    useUIStore.setState({ sidebarWidth: 360, rightPanelWidth: 500 })
    // The mount-time clamp uses the current window size without needing a resize event.
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 640 })
    render(<MainLayoutShell left={<div />} center={<div />} right={<div />} />)

    const s = useUIStore.getState()
    expect(s.sidebarWidth).toBe(256) // 40% of 640
    expect(s.rightPanelWidth).toBe(280) // 640 - 256 - 120 = 264 → clamped to min 280
  })
})
