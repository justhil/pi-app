import { useState } from 'react'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CustomCssOverride, CustomTheme } from '@shared/custom-theme'
import type { SettingsDraft } from './settings-draft'
import { AppearanceThemeEditor } from './appearance-theme-editor'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) => {
      if (key.endsWith('unsupportedFields')) return `${values?.count} unsupported`
      if (key.endsWith('importError')) return `error: ${values?.error}`
      if (key.endsWith('contrastWarning')) return `contrast ${values?.ratio}`
      return key.replace('settings:appearance.', '')
    },
  }),
}))

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}))

interface DraftActions {
  setCustomTheme: (theme: CustomTheme) => void
  setCustomCssOverride: (override: CustomCssOverride) => void
}

let currentDraft: SettingsDraft
let currentActions: DraftActions

vi.mock('./settings-draft-context', () => ({
  useSettingsDraft: () => ({ draft: currentDraft, ...currentActions }),
}))

function baseDraft(): SettingsDraft {
  return {
    theme: 'system',
    iconTheme: 'phosphor',
    customTheme: {},
    customCssOverride: { enabled: false, css: '' },
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
    timelineMaxAutoExpandedTools: 0,
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

function Harness() {
  const [draft, setDraft] = useState(baseDraft)
  currentDraft = draft
  currentActions = {
    setCustomTheme: (customTheme) => setDraft((value) => ({ ...value, customTheme })),
    setCustomCssOverride: (customCssOverride) =>
      setDraft((value) => ({ ...value, customCssOverride })),
  }
  return <AppearanceThemeEditor />
}

function lightSection(): HTMLElement {
  return screen.getByRole('heading', { name: 'variantLight' }).closest('section') as HTMLElement
}

function darkSection(): HTMLElement {
  return screen.getByRole('heading', { name: 'variantDark' }).closest('section') as HTMLElement
}

async function chooseLightPreset(user: ReturnType<typeof userEvent.setup>) {
  const select = within(lightSection()).getByRole('combobox', { name: 'preset' })
  await user.selectOptions(select, 'vscode-plus')
}

afterEach(() => cleanup())

describe('AppearanceThemeEditor', () => {
  it('fills a slot from a preset, marks manual edits custom, and restores default', async () => {
    const user = userEvent.setup()
    render(<Harness />)

    await chooseLightPreset(user)
    expect(currentDraft.customTheme.light).toMatchObject({
      preset: 'vscode-plus',
      accent: '#007acc',
      surface: '#ffffff',
      ink: '#000000',
      contrast: 45,
      diffAdded: '#008000',
      diffRemoved: '#ee0000',
    })

    fireEvent.change(within(lightSection()).getByRole('slider', { name: 'contrast' }), {
      target: { value: '52' },
    })
    expect(currentDraft.customTheme.light).toMatchObject({ preset: null, contrast: 52 })

    await user.click(within(lightSection()).getByRole('button', { name: 'restoreDefault' }))
    expect(currentDraft.customTheme.light).toBeUndefined()
  })

  it('imports atomically into the payload variant and leaves the draft unchanged on errors', async () => {
    const user = userEvent.setup()
    render(<Harness />)

    await user.click(within(lightSection()).getByRole('button', { name: 'importTheme' }))
    const dialog = screen.getByRole('dialog')
    const textarea = within(dialog).getByRole('textbox', { name: 'importValueLabel' })
    const invalid = 'codex-theme-v1:{bad json}'
    fireEvent.change(textarea, { target: { value: invalid } })
    await user.click(within(dialog).getByRole('button', { name: 'previewImport' }))
    expect(within(dialog).getByRole('alert')).toHaveTextContent('error:')
    expect(currentDraft.customTheme).toEqual({})

    fireEvent.change(textarea, {
      target: {
        value: `codex-theme-v1:${JSON.stringify({
          codeThemeId: 'vscode-plus',
          theme: {
            accent: '#339cff',
            contrast: 60,
            fonts: { code: null, ui: null },
            ink: '#ffffff',
            opaqueWindows: true,
            semanticColors: { skill: '#0000ff' },
            variant: 'dark',
            surface: '#181818',
          },
        })}`,
      },
    })
    await user.click(within(dialog).getByRole('button', { name: 'previewImport' }))
    expect(within(dialog).getByText('variantDark')).toBeInTheDocument()
    expect(within(dialog).getByText('2')).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'confirmImport' }))

    expect(currentDraft.customTheme.light).toBeUndefined()
    expect(currentDraft.customTheme.dark).toMatchObject({
      accent: '#339cff',
      surface: '#181818',
      ink: '#ffffff',
      contrast: 60,
    })
  })

  it('limits built-in presets to their matching variant and normalizes fonts on commit', async () => {
    const user = userEvent.setup()
    render(<Harness />)

    expect(within(lightSection()).queryByRole('option', { name: 'presetCodex' })).not.toBeInTheDocument()
    expect(within(darkSection()).queryByRole('option', { name: 'presetVscodePlus' })).not.toBeInTheDocument()

    await chooseLightPreset(user)
    const fontInput = within(lightSection()).getByRole('textbox', { name: 'fontUi' })
    await user.type(fontInput, "Bad';  Font")
    await user.tab()
    expect(currentDraft.customTheme.light?.fontUi).toBe('Bad Font')
  })

  it('enables, preserves, and clears the advanced CSS draft', async () => {
    const user = userEvent.setup()
    render(<Harness />)

    await user.click(screen.getByRole('button', { name: /expand/ }))
    const css = screen.getByRole('textbox', { name: 'customCss' })
    fireEvent.change(css, { target: { value: ':root { --brand: #007acc; }' } })
    await user.click(screen.getByRole('switch', { name: 'customCssEnabled' }))

    expect(currentDraft.customCssOverride).toEqual({
      enabled: true,
      css: ':root { --brand: #007acc; }',
    })

    await user.click(screen.getByRole('button', { name: 'clearCustomCss' }))
    expect(currentDraft.customCssOverride).toEqual({ enabled: false, css: '' })
  })

  it('keeps the copy action disabled while a slot uses the real Pi default', () => {
    render(<Harness />)
    expect(within(darkSection()).getByRole('button', { name: 'copyTheme' })).toBeDisabled()
  })
})
