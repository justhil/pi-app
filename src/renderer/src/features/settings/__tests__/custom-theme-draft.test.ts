import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SettingsDraft } from '../settings-draft'

const invokeMock = vi.fn()

vi.mock('@renderer/lib/ipc-client', () => ({
  ipcClient: {
    invoke: (...args: unknown[]) => invokeMock(...args),
  },
}))

vi.mock('@renderer/components/icons', () => ({
  applyIconTheme: vi.fn(),
}))

vi.mock('@renderer/stores/ui-store', () => ({
  useUIStore: {
    getState: () => ({
      setTheme: vi.fn(),
      setTimelineMaxAutoExpandedTools: vi.fn(),
      applyRightPanelRuntime: vi.fn(),
    }),
  },
}))

function draft(): SettingsDraft {
  return {
    theme: 'light',
    iconTheme: 'phosphor',
    customTheme: {},
    customCssOverride: { enabled: true, css: ':root { --brand: #ff0000; }' },
    language: 'en',
    autoOpenLastProject: true,
    autoCheckRegistryUpdates: true,
    alertSoundEnabled: true,
    alertNotificationEnabled: true,
    alertOnExtensionUi: true,
    alertOnRunIdle: true,
    alertOnBackgroundRunIdle: false,
    maxSessionWorkers: 4,
    sessionWorkerIdleTimeoutMinutes: 15,
    timelineMaxAutoExpandedTools: 3,
    extensionOverrides: {},
    rightPanelCatalog: [],
    rightPanelPrefs: {},
    rightPanelOrder: [],
    asrConfig: {
      provider: 'codex-asr-builtin',
      language: 'auto',
      timeoutMs: 120000,
      builtinServePort: 18788,
    },
    agentRuntime: { mode: 'host', distro: null },
  }
}

describe('custom theme settings draft contract', () => {
  beforeEach(() => {
    delete window.piDesktop
    document.getElementById('pi-custom-theme')?.remove()
    document.getElementById('pi-custom-css')?.remove()
    localStorage.clear()
    invokeMock.mockReset()
  })

  it('loads the independent CSS override and includes it in the dirty signature', async () => {
    invokeMock.mockImplementation(async (method: string) => {
      if (method === 'settings.get') {
        return { settings: { customTheme: null, customCssOverride: { enabled: true, css: 'body{}' } } }
      }
      return { catalog: [] }
    })
    const { draftSignature, loadSettingsDraftFromDisk } = await import('../settings-draft')

    const loaded = await loadSettingsDraftFromDisk('en')
    const changed = { ...loaded, customCssOverride: { ...loaded.customCssOverride, css: 'body{color:red}' } }
    const changedIcons = { ...loaded, iconTheme: 'lucide' as const }

    expect(loaded.iconTheme).toBe('phosphor')
    expect(loaded.customTheme).toEqual({})
    expect(loaded.customCssOverride).toEqual({ enabled: true, css: 'body{}' })
    expect(draftSignature(changed)).not.toBe(draftSignature(loaded))
    expect(draftSignature(changedIcons)).not.toBe(draftSignature(loaded))
  })

  it('previews both layers in order and skips them together in safe mode', async () => {
    const { previewDraftUi } = await import('../settings-draft')
    const i18n = { language: 'en', changeLanguage: vi.fn() }
    const value = draft()
    value.customTheme = {
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
    }

    previewDraftUi(value, i18n as never)
    expect(document.getElementById('pi-custom-theme')?.nextElementSibling?.id).toBe('pi-custom-css')

    window.piDesktop = { customThemeDisabled: true } as Window['piDesktop']
    previewDraftUi(value, i18n as never)
    expect(document.getElementById('pi-custom-theme')).toBeNull()
    expect(document.getElementById('pi-custom-css')).toBeNull()
  })

  it('commits the CSS override as one settings value', async () => {
    invokeMock.mockResolvedValue({ value: draft().asrConfig })
    const { commitSettingsDraft } = await import('../settings-draft')
    const i18n = { language: 'en', changeLanguage: vi.fn() }

    await commitSettingsDraft(draft(), i18n as never)

    expect(invokeMock).toHaveBeenCalledWith('settings.set', {
      key: 'iconTheme',
      value: 'phosphor',
    })
    expect(invokeMock).toHaveBeenCalledWith('settings.set', {
      key: 'customCssOverride',
      value: { enabled: true, css: ':root { --brand: #ff0000; }' },
    })
    expect(invokeMock).toHaveBeenCalledWith('settings.set', { key: 'customTheme', value: null })
  })
})
