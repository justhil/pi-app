import { beforeEach, describe, expect, it, vi } from 'vitest'

const invokeMock = vi.fn()
const setThemeMock = vi.fn()

vi.mock('@renderer/lib/ipc-client', () => ({
  ipcClient: {
    invoke: (...args: unknown[]) => invokeMock(...args),
  },
}))

vi.mock('@renderer/stores/ui-store', () => ({
  useUIStore: {
    getState: () => ({
      setTheme: setThemeMock,
      setTimelineMaxAutoExpandedTools: vi.fn(),
      applyRightPanelRuntime: vi.fn(),
    }),
  },
}))

describe('hydrateThemeFromSettings', () => {
  beforeEach(() => {
    document.documentElement.classList.remove('dark')
    invokeMock.mockReset()
    setThemeMock.mockReset()
  })

  it('should_apply_dark_class_and_sync_ui_store_when_settings_theme_is_dark', async () => {
    invokeMock.mockResolvedValue({ settings: { theme: 'dark' } })
    const { hydrateThemeFromSettings } = await import('../settings-draft')

    await hydrateThemeFromSettings()

    expect(invokeMock).toHaveBeenCalledWith('settings.get', { key: 'theme' })
    expect(document.documentElement.classList.contains('dark')).toBe(true)
    expect(setThemeMock).toHaveBeenCalledWith('dark')
  })

  it('should_default_to_system_when_theme_missing', async () => {
    invokeMock.mockResolvedValue({ settings: {} })
    const { hydrateThemeFromSettings } = await import('../settings-draft')

    await hydrateThemeFromSettings()

    expect(setThemeMock).toHaveBeenCalledWith('system')
  })
})
