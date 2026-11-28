import { act, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { MainLayoutShell } from './main-layout-shell'
import { applyUiZoom } from '@renderer/lib/ui-zoom'
import { useUIStore } from '@renderer/stores/ui-store'

const DEFAULTS = {
  sidebarWidth: 260,
  sidebarCollapsed: false,
  rightPanelWidth: 288,
  rightPanelCollapsed: false,
  rightPanelExpandedOnNarrow: true,
}

beforeEach(() => {
  useUIStore.setState(DEFAULTS)
})

afterEach(() => {
  useUIStore.setState(DEFAULTS)
  document.documentElement.style.zoom = '1'
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1024 })
})

function resizeWindow(width: number) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width })
  act(() => {
    window.dispatchEvent(new Event('resize'))
  })
}

function gridColumns(): string {
  const shell = document.querySelector('.shell-three-col') as HTMLElement | null
  return shell?.style.gridTemplateColumns || ''
}

describe('MainLayoutShell window-resize adaptation', () => {
  it('keeps the Files toolbar within a 375px viewport with the sidebar open', () => {
    render(<MainLayoutShell left={<div />} center={<div />} right={<div />} />)
    resizeWindow(375)
    expect(gridColumns()).toBe('200px minmax(0, 1fr) 175px')
    expect(useUIStore.getState().rightPanelWidth).toBe(DEFAULTS.rightPanelWidth)
  })

  it('recalculates available layout width when UI zoom changes without window resizing', () => {
    render(<MainLayoutShell left={<div />} center={<div />} right={<div />} />)
    resizeWindow(375)
    act(() => applyUiZoom(1.1))
    const right = Number(gridColumns().match(/ ([\d.]+)px$/)?.[1])
    expect((200 + right) * 1.1).toBeCloseTo(375)
    expect(useUIStore.getState().sidebarWidth).toBe(DEFAULTS.sidebarWidth)
  })

  it('clamps both panels in the rendered grid when the window shrinks, without overwriting persisted widths', () => {
    render(<MainLayoutShell left={<div />} center={<div />} right={<div />} />)
    useUIStore.setState({ sidebarWidth: 360, rightPanelWidth: 500 })

    resizeWindow(700)

    // 持久化首选宽度保持原样：缩小窗口不得永久覆盖用户设置
    const s = useUIStore.getState()
    expect(s.sidebarWidth).toBe(360)
    expect(s.rightPanelWidth).toBe(500)
    // 展示值按当前窗口 clamp：侧栏 ≤40%（280），右栏 ≤ 700-280-120=300
    expect(gridColumns()).toBe('280px minmax(0, 1fr) 300px')
  })

  it('keeps panel widths when the window grows', () => {
    render(<MainLayoutShell left={<div />} center={<div />} right={<div />} />)
    useUIStore.setState({ sidebarWidth: 260, rightPanelWidth: 288 })

    resizeWindow(1800)

    const s = useUIStore.getState()
    expect(s.sidebarWidth).toBe(260)
    expect(s.rightPanelWidth).toBe(288)
    expect(gridColumns()).toBe('260px minmax(0, 1fr) 288px')
  })

  it('does not touch the sidebar width while it is collapsed', () => {
    render(<MainLayoutShell left={<div />} center={<div />} right={<div />} />)
    useUIStore.setState({ sidebarWidth: 360, sidebarCollapsed: true, rightPanelWidth: 500 })

    resizeWindow(700)

    const s = useUIStore.getState()
    expect(s.sidebarWidth).toBe(360)
    expect(s.rightPanelWidth).toBe(500)
    // 收起侧栏走 40px rail：右栏 500 放得下 → 展示不变
    expect(gridColumns()).toBe('0px minmax(0, 1fr) 500px')
  })

  it('should_collapse_right_panel_to_rail_on_narrow_window_until_expanded', () => {
    useUIStore.setState({ rightPanelExpandedOnNarrow: false, rightPanelWidth: 288, rightPanelRailIcons: false })
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 900 })
    render(<MainLayoutShell left={<div />} center={<div />} right={<div />} />)

    // No icon rail by default: the collapsed panel takes no width.
    expect(gridColumns()).toBe('260px minmax(0, 1fr) 0px')
  })

  it('keeps the icon rail when the setting is on', () => {
    useUIStore.setState({ rightPanelCollapsed: true, rightPanelRailIcons: true })
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1400 })
    render(<MainLayoutShell left={<div />} center={<div />} right={<div />} />)
    expect(gridColumns()).toBe('260px minmax(0, 1fr) 40px')
    useUIStore.setState({ rightPanelRailIcons: false })
  })

  it('adapts persisted oversized widths on mount without writing them back', () => {
    useUIStore.setState({ sidebarWidth: 360, rightPanelWidth: 500 })
    // 挂载时按当前窗口 clamp（无需 resize 事件）
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 640 })
    render(<MainLayoutShell left={<div />} center={<div />} right={<div />} />)

    const s = useUIStore.getState()
    // 持久化值未被改写
    expect(s.sidebarWidth).toBe(360)
    expect(s.rightPanelWidth).toBe(500)
    // 展示 clamp：侧栏 40% of 640 = 256；右栏 640-256-120=264 → 最小值 280
    expect(gridColumns()).toBe('256px minmax(0, 1fr) 280px')
  })
})

describe('MainLayoutShell left sidebar drag-to-collapse', () => {
  it('should_collapse_left_sidebar_when_dragged_past_collapse_threshold_and_preserve_prior_width', () => {
    useUIStore.setState({ sidebarWidth: 280, sidebarCollapsed: false })
    const { container } = render(<MainLayoutShell left={<div />} center={<div />} right={<div />} />)
    const handle = container.querySelector('.panel-resize-edge--left') as HTMLElement
    expect(handle).not.toBeNull()

    fireEvent.mouseDown(handle, { clientX: 280 })
    act(() => {
      window.dispatchEvent(new MouseEvent('mousemove', { clientX: 220 }))
    })
    expect(useUIStore.getState().sidebarCollapsed).toBe(false)

    // Still inside anti-accidental-close buffer (90px >= 64px): must NOT collapse yet.
    act(() => {
      window.dispatchEvent(new MouseEvent('mousemove', { clientX: 90 }))
    })
    expect(useUIStore.getState().sidebarCollapsed).toBe(false)

    // Drag past collapse threshold (< 64px, close to left edge)
    act(() => {
      window.dispatchEvent(new MouseEvent('mousemove', { clientX: 50 }))
    })
    expect(useUIStore.getState().sidebarCollapsed).toBe(true)

    act(() => {
      window.dispatchEvent(new MouseEvent('mouseup', { clientX: 50 }))
    })
    expect(useUIStore.getState().sidebarCollapsed).toBe(true)
    // Restores pre-drag width so re-opening returns to the user's prior width instead of 200px minimum.
    expect(useUIStore.getState().sidebarWidth).toBe(280)
  })

  it('should_keep_left_sidebar_open_when_dragged_above_collapse_threshold', () => {
    useUIStore.setState({ sidebarWidth: 260, sidebarCollapsed: false })
    const { container } = render(<MainLayoutShell left={<div />} center={<div />} right={<div />} />)
    const handle = container.querySelector('.panel-resize-edge--left') as HTMLElement

    fireEvent.mouseDown(handle, { clientX: 260 })
    act(() => {
      window.dispatchEvent(new MouseEvent('mousemove', { clientX: 100 }))
      window.dispatchEvent(new MouseEvent('mouseup', { clientX: 100 }))
    })

    expect(useUIStore.getState().sidebarCollapsed).toBe(false)
    expect(useUIStore.getState().sidebarWidth).toBe(200)
  })

  it('should_reopen_left_sidebar_when_dragged_back_past_hysteresis_before_mouseup', () => {
    useUIStore.setState({ sidebarWidth: 260, sidebarCollapsed: false })
    const { container } = render(<MainLayoutShell left={<div />} center={<div />} right={<div />} />)
    const handle = container.querySelector('.panel-resize-edge--left') as HTMLElement

    fireEvent.mouseDown(handle, { clientX: 260 })
    act(() => {
      window.dispatchEvent(new MouseEvent('mousemove', { clientX: 50 }))
    })
    expect(useUIStore.getState().sidebarCollapsed).toBe(true)

    // Inside hysteresis deadband (80px < 100px): stays collapsed without jitter
    act(() => {
      window.dispatchEvent(new MouseEvent('mousemove', { clientX: 80 }))
    })
    expect(useUIStore.getState().sidebarCollapsed).toBe(true)

    // Pull back past reopen threshold (>= 100px) before releasing mouse
    act(() => {
      window.dispatchEvent(new MouseEvent('mousemove', { clientX: 230 }))
      window.dispatchEvent(new MouseEvent('mouseup', { clientX: 230 }))
    })
    expect(useUIStore.getState().sidebarCollapsed).toBe(false)
    expect(useUIStore.getState().sidebarWidth).toBe(230)
  })
})
