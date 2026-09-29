import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ipcClient } from '@renderer/lib/ipc-client'
import { clearAvailableModelsCacheForTests } from '@renderer/lib/available-models-cache'
import { ModelDefaultsSection, changedModelDefaults } from './model-defaults-section'
import { commitAllSettingsSlices, getDirtySettingsSlices } from './settings-dirty-registry'

vi.mock('@renderer/lib/ipc-client', () => ({
  ipcClient: { invoke: vi.fn() },
  onAppEvent: vi.fn(() => () => {}),
}))
vi.mock('@renderer/lib/composer-run-display', () => ({ refreshComposerRunDisplay: vi.fn(async () => {}) }))
vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-i18next')>()),
  useTranslation: () => ({ t: (key: string) => key }),
}))

const invoke = vi.mocked(ipcClient.invoke)
let stored: Record<string, unknown>

beforeEach(() => {
  clearAvailableModelsCacheForTests()
  stored = {
    defaultProvider: 'legacy',
    defaultModel: 'saved',
    defaultThinkingLevel: 'medium',
    modelThinkingLevels: { 'anthropic/opus': 'max' },
  }
  invoke.mockReset()
  invoke.mockImplementation(async (method: string, req?: unknown) => {
    if (method === 'pi.settings.get') return { settings: stored }
    if (method === 'pi.settings.set') {
      stored = { ...stored, ...(req as { patch: Record<string, unknown> }).patch }
      return { ok: true }
    }
    if (method === 'model.list') {
      return {
        models: [
          { provider: 'anthropic', id: 'opus', available: true },
          { provider: 'openai', id: 'gpt-6', available: true },
        ],
      }
    }
    return {}
  })
})

describe('ModelDefaultsSection', () => {
  it('lists available models, keeps an unavailable configured default visible, and shows bindings', async () => {
    render(<ModelDefaultsSection />)
    const defaultModel = await screen.findByRole('combobox', { name: 'settings:modelDefaults.defaultModel' })
    await waitFor(() =>
      expect([...defaultModel.querySelectorAll('option')].map((o) => o.getAttribute('value'))).toEqual([
        '',
        'legacy/saved',
        'anthropic/opus',
        'openai/gpt-6',
      ]),
    )
    expect(defaultModel).toHaveValue('legacy/saved')
    expect(within(defaultModel).getByRole('option', { name: /legacy\/saved · settings:modelDefaults.bindingMissing/ })).toBeInTheDocument()
    expect(invoke).toHaveBeenCalledWith('model.list', { scope: 'available' })
    expect(screen.getByRole('combobox', { name: 'settings:modelDefaults.bindingLevel' })).toHaveValue('max')
  })

  it('binds a level to a model and saves only the changed keys', async () => {
    render(<ModelDefaultsSection />)
    const picker = await screen.findByRole('combobox', { name: 'settings:modelDefaults.pickModel' })
    await waitFor(() => expect(within(picker).getByRole('option', { name: 'gpt-6' })).toBeInTheDocument())
    fireEvent.change(picker, { target: { value: 'openai/gpt-6' } })
    fireEvent.change(screen.getByRole('combobox', { name: 'settings:modelDefaults.pickLevel' }), { target: { value: 'xhigh' } })
    fireEvent.click(screen.getByRole('button', { name: /settings:modelDefaults.addBinding/ }))

    expect(getDirtySettingsSlices().map((slice) => slice.id)).toContain('model-defaults')
    await act(async () => {
      await commitAllSettingsSlices()
    })
    const setCall = invoke.mock.calls.find(([method]) => method === 'pi.settings.set')
    expect(setCall?.[1]).toEqual({
      patch: { modelThinkingLevels: { 'anthropic/opus': 'max', 'openai/gpt-6': 'xhigh' } },
    })
  })

  it('clears the cycling scope with null (IPC drops undefined)', () => {
    const base = { modelThinkingLevels: {}, enabledModels: ['anthropic/*'] }
    expect(changedModelDefaults({ ...base, enabledModels: undefined }, base)).toEqual({ enabledModels: null })
  })
})
