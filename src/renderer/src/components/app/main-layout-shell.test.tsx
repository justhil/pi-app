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

function gridColumns(): string {
  const shell = document.querySelector('.shell-three-col') as HTMLElement | null
  return shell?.style.gridTemplateColumns || ''
}

describe('MainLayoutShell window-resize adaptation', () => {
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
