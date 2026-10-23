import { beforeEach, describe, expect, it, vi } from 'vitest'

const invokeMock = vi.fn()
const setThemeMock = vi.fn()
const applyIconThemeMock = vi.fn()
const setStateMock = vi.fn()

vi.mock('@renderer/lib/ipc-client', () => ({
  ipcClient: {
    invoke: (...args: unknown[]) => invokeMock(...args),
  },
}))

vi.mock('@renderer/components/icons', () => ({
  applyIconTheme: (...args: unknown[]) => applyIconThemeMock(...args),
}))

vi.mock('@renderer/stores/ui-store', () => ({
  useUIStore: {
    setState: (...args: unknown[]) => setStateMock(...args),
    getState: () => ({
      setTheme: setThemeMock,
      setTimelineMaxAutoExpandedTools: vi.fn(),
      applyRightPanelRuntime: vi.fn(),
    }),
  },
}))

describe('hydrateThemeFromSettings', () => {
  beforeEach(() => {
    delete window.piDesktop
    document.documentElement.classList.remove('dark')
    document.getElementById('pi-custom-theme')?.remove()
    document.getElementById('pi-custom-css')?.remove()
    localStorage.removeItem('pi-desktop-theme-css')
    localStorage.removeItem('pi-desktop-custom-css')
    invokeMock.mockReset()
    setThemeMock.mockReset()
    applyIconThemeMock.mockReset()
    setStateMock.mockReset()
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

  it('hydrates icon theme and defaults invalid values to phosphor', async () => {
    invokeMock.mockResolvedValue({ settings: { iconTheme: 'iconoir' } })
    const { loadSettingsDraftFromDisk, previewDraftUi } = await import('../settings-draft')
    const i18n = { language: 'en', changeLanguage: vi.fn() }

    const loaded = await loadSettingsDraftFromDisk('en')
    previewDraftUi(loaded, i18n as never)

    expect(loaded.iconTheme).toBe('iconoir')
    expect(applyIconThemeMock).toHaveBeenCalledWith('iconoir')
    expect(setStateMock).toHaveBeenCalledWith({ sidebarStyle: loaded.sidebarStyle })
  })

  it('should_rebuild_custom_theme_css_from_settings', async () => {
    invokeMock.mockResolvedValue({
      settings: {
        customTheme: {
          light: {
            preset: 'vscode-plus',
            accent: '#007acc',
            surface: '#fff',
            ink: '#000',
            contrast: 45,
            fontUi: null,
            fontCode: null,
            translucentSidebar: false,
          },
        },
      },
    })
    const { hydrateCustomThemeFromSettings } = await import('../settings-draft')

    await hydrateCustomThemeFromSettings()

    expect(invokeMock).toHaveBeenCalledWith('settings.get', { key: 'customTheme' })
    const css = document.getElementById('pi-custom-theme')?.textContent
    expect(css).toContain(':root:not(.dark)')
    expect(css).toContain('--brand: #007acc;')
    expect(css).toContain('--bg-base: #ffffff;')
    expect(css).toContain(':root.dark {}')
    expect(localStorage.getItem('pi-desktop-theme-css')).toBe(css)
  })

  it('should_remove_stale_bootstrap_css_when_settings_have_no_custom_theme', async () => {
    const staleStyle = document.createElement('style')
    staleStyle.id = 'pi-custom-theme'
    staleStyle.textContent = ':root { --brand: #ff0000; }'
    document.head.appendChild(staleStyle)
    localStorage.setItem('pi-desktop-theme-css', staleStyle.textContent)
    invokeMock.mockResolvedValue({ settings: { customTheme: null } })
    const { hydrateCustomThemeFromSettings } = await import('../settings-draft')

    await hydrateCustomThemeFromSettings()

    expect(document.getElementById('pi-custom-theme')).toBeNull()
    expect(localStorage.getItem('pi-desktop-theme-css')).toBeNull()
  })

  it('should_hydrate_free_css_after_structured_theme', async () => {
    const themeStyle = document.createElement('style')
    themeStyle.id = 'pi-custom-theme'
    document.head.appendChild(themeStyle)
    invokeMock.mockResolvedValue({
      settings: { customCssOverride: { enabled: true, css: ':root { --brand: #ff0000; }' } },
    })
    const { hydrateCustomCssOverrideFromSettings } = await import('../settings-draft')

    await hydrateCustomCssOverrideFromSettings()

    const customStyle = document.getElementById('pi-custom-css')
    expect(invokeMock).toHaveBeenCalledWith('settings.get', { key: 'customCssOverride' })
    expect(customStyle?.textContent).toBe(':root { --brand: #ff0000; }')
    expect(themeStyle.nextElementSibling).toBe(customStyle)
    expect(localStorage.getItem('pi-desktop-custom-css')).toBe(customStyle?.textContent)
  })

  it('should_not_reactivate_either_custom_layer_when_safe_mode_is_enabled', async () => {
    window.piDesktop = { customThemeDisabled: true } as Window['piDesktop']
    invokeMock.mockImplementation(async (_method: string, request: { key?: string }) => {
      if (request.key === 'customTheme') {
        return {
          settings: {
            customTheme: {
              light: {
                preset: null,
                accent: '#007acc',
                surface: '#ffffff',
                ink: '#000000',
                contrast: 45,
                fontUi: null,
                fontCode: null,
                translucentSidebar: false,
              },
            },
          },
        }
      }
      return {
        settings: { customCssOverride: { enabled: true, css: ':root { display: none; }' } },
      }
    })
    const { hydrateCustomCssOverrideFromSettings, hydrateCustomThemeFromSettings } = await import(
      '../settings-draft'
    )

    await hydrateCustomThemeFromSettings()
    await hydrateCustomCssOverrideFromSettings()

    expect(document.getElementById('pi-custom-theme')).toBeNull()
    expect(document.getElementById('pi-custom-css')).toBeNull()
  })
})
