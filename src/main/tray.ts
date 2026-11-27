import { app, Menu, Tray } from 'electron'
import { resolveAppIcon } from './app-icon'
import { resolveUiLanguage } from './ui-language'
import { getMainWindow } from './window'

let appTray: Tray | null = null

export function focusMainWindow(): void {
  const window = getMainWindow()
  if (!window) return
  if (window.isMinimized()) window.restore()
  if (!window.isVisible()) window.show()
  window.focus()
}

function openTrayMenu(): void {
  const window = getMainWindow()
  const visible = window?.isVisible() ?? false
  const language = resolveUiLanguage()
  const label = (zh: string, en: string, ru: string) => (language === 'zh' ? zh : language === 'ru' ? ru : en)
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: visible
        ? label('隐藏窗口', 'Hide Window', 'Скрыть окно')
        : label('显示窗口', 'Show Window', 'Показать окно'),
      click: visible ? () => getMainWindow()?.hide() : focusMainWindow,
    },
    { type: 'separator' },
    { label: label('退出', 'Quit', 'Выход'), click: () => app.quit() },
  ]
  Menu.buildFromTemplate(template).popup()
}

export function ensureAppTray(platform = process.platform): Tray | null {
  if (platform !== 'win32') return null
  if (appTray) return appTray

  const icon = resolveAppIcon()
  if (!icon) {
    console.warn('[Tray] App icon is unavailable')
    return null
  }

  appTray = new Tray(icon)
  appTray.setToolTip('pi Desktop')
  appTray.on('click', focusMainWindow)
  appTray.on('right-click', openTrayMenu)
  return appTray
}

export function destroyAppTray(): void {
  appTray?.destroy()
  appTray = null
}
