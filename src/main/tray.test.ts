import { beforeEach, describe, expect, it, vi } from 'vitest'

const electron = vi.hoisted(() => {
  const trays: FakeTray[] = []
  const windows: FakeWindow[] = []
  const menuTemplates: Array<Array<{ label?: string; type?: string; click?: () => void }>> = []
  const popup = vi.fn()
  const quit = vi.fn()

  class FakeTray {
    tooltip = ''
    destroyed = false
    listeners = new Map<string, () => void>()

    constructor(readonly image: unknown) {
      trays.push(this)
    }

    setToolTip(value: string): void {
      this.tooltip = value
    }

    on(event: string, listener: () => void): void {
      this.listeners.set(event, listener)
    }

    destroy(): void {
      this.destroyed = true
    }
  }

  class FakeWindow {
    minimized = true
    visible = false
    destroyed = false
    restore = vi.fn(() => { this.minimized = false })
    show = vi.fn(() => { this.visible = true })
    hide = vi.fn(() => { this.visible = false })
    focus = vi.fn()
    isMinimized = vi.fn(() => this.minimized)
    isVisible = vi.fn(() => this.visible)
    isDestroyed = vi.fn(() => this.destroyed)
  }

  return { FakeTray, FakeWindow, menuTemplates, popup, quit, trays, windows }
})

const config = vi.hoisted(() => ({ language: 'zh' as 'zh' | 'en' }))
const icon = { isEmpty: () => false }

vi.mock('electron', () => ({
  app: { quit: electron.quit },
  Tray: electron.FakeTray,
  BrowserWindow: { getAllWindows: () => electron.windows },
  Menu: {
    buildFromTemplate: (template: Array<{ label?: string; type?: string; click?: () => void }>) => {
      electron.menuTemplates.push(template)
      return { popup: electron.popup }
    },
  },
}))

vi.mock('./app-icon', () => ({
  resolveAppIcon: () => icon,
}))

vi.mock('./config-store', () => ({
  configStore: { get: () => config.language },
}))

import { destroyAppTray, ensureAppTray } from './tray'

describe('Windows app tray lifecycle', () => {
  beforeEach(() => {
    destroyAppTray()
    electron.trays.length = 0
    electron.windows.length = 0
    electron.menuTemplates.length = 0
    electron.popup.mockClear()
    electron.quit.mockClear()
    config.language = 'zh'
  })

  it('creates and retains one Windows tray with the Pi tooltip', () => {
    const first = ensureAppTray('win32')
    const second = ensureAppTray('win32')

    expect(first).toBe(second)
    expect(electron.trays).toHaveLength(1)
    expect(electron.trays[0].image).toBe(icon)
    expect(electron.trays[0].tooltip).toBe('pi Desktop')
  })

  it('restores and focuses the current window when the tray icon is clicked', () => {
    const win = new electron.FakeWindow()
    electron.windows.push(win)
    ensureAppTray('win32')

    electron.trays[0].listeners.get('click')?.()

    expect(win.restore).toHaveBeenCalledOnce()
    expect(win.show).toHaveBeenCalledOnce()
    expect(win.focus).toHaveBeenCalledOnce()
  })

  it('builds an English right-click menu from current visibility and invokes native hide/quit operations', () => {
    config.language = 'en'
    const win = new electron.FakeWindow()
    win.visible = true
    electron.windows.push(win)
    ensureAppTray('win32')

    electron.trays[0].listeners.get('right-click')?.()

    const menu = electron.menuTemplates[0]
    expect(menu.map((item) => item.label ?? item.type)).toEqual(['Hide Window', 'separator', 'Quit'])
    expect(electron.popup).toHaveBeenCalledOnce()
    menu[0].click?.()
    menu[2].click?.()
    expect(win.hide).toHaveBeenCalledOnce()
    expect(electron.quit).toHaveBeenCalledOnce()
  })

  it('builds a Chinese Show menu when opened while hidden and restores the existing window', () => {
    const win = new electron.FakeWindow()
    electron.windows.push(win)
    ensureAppTray('win32')

    electron.trays[0].listeners.get('right-click')?.()

    const menu = electron.menuTemplates[0]
    expect(menu.map((item) => item.label ?? item.type)).toEqual(['显示窗口', 'separator', '退出'])
    menu[0].click?.()
    expect(win.restore).toHaveBeenCalledOnce()
    expect(win.show).toHaveBeenCalledOnce()
    expect(win.focus).toHaveBeenCalledOnce()
    expect(electron.windows).toHaveLength(1)
  })

  it('does not create a tray on unsupported platforms and destroys its owned instance on quit', () => {
    expect(ensureAppTray('darwin')).toBeNull()
    expect(electron.trays).toHaveLength(0)

    ensureAppTray('win32')
    destroyAppTray()

    expect(electron.trays[0].destroyed).toBe(true)
  })
})
