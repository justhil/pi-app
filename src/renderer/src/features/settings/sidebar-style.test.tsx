import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useUIStore } from '@renderer/stores/ui-store'
import { AppearanceSettings } from './settings-general-appearance'
import { SettingsDraftProvider, useSettingsDraft } from './settings-draft-context'
import { draftSignature, loadSettingsDraftFromDisk } from './settings-draft'

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }))
vi.mock('@renderer/lib/ipc-client', () => ({ ipcClient: { invoke: mocks.invoke } }))
vi.mock('./appearance-theme-editor', () => ({ AppearanceThemeEditor: () => null }))
vi.mock('./runtime-settings-panel', () => ({ RuntimeSettingsPanel: () => null }))
vi.mock('./pi-settings-panel', () => ({ PiSettingsPanel: () => null }))

function Settings() {
  const { dirty, save, discard } = useSettingsDraft()
  return <>
    <AppearanceSettings />
    <button type="button" disabled={!dirty} onClick={() => void save()}>Save changes</button>
    <button type="button" onClick={() => void discard()}>Discard changes</button>
  </>
}

beforeEach(() => {
  useUIStore.setState({ sidebarStyle: 'full' })
  mocks.invoke.mockReset()
  mocks.invoke.mockImplementation(async (method: string) => {
    if (method === 'settings.get') return { settings: { sidebarStyle: 'full', language: 'en' } }
    if (method === 'rightPanels.catalog') return { catalog: [] }
    return { ok: true }
  })
})

describe('sidebar appearance preference', () => {
  it('previews, discards and saves through the existing settings draft', async () => {
    render(<SettingsDraftProvider><Settings /></SettingsDraftProvider>)
    const compact = await screen.findByRole('button', { name: 'Compact' })
    expect(screen.getByRole('button', { name: 'Full' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(compact)
    expect(useUIStore.getState().sidebarStyle).toBe('compact')
    expect(compact).toHaveAttribute('aria-pressed', 'true')
    expect(mocks.invoke).not.toHaveBeenCalledWith('settings.set', expect.anything())
    fireEvent.click(screen.getByRole('button', { name: 'Discard changes' }))
    await waitFor(() => expect(useUIStore.getState().sidebarStyle).toBe('full'))
    fireEvent.click(screen.getByRole('button', { name: 'Compact' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith('settings.set', { key: 'sidebarStyle', value: 'compact' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled())
    mocks.invoke.mockImplementation(async (method: string) => method === 'settings.get'
      ? { settings: { sidebarStyle: 'compact' } } : { catalog: [] })
    expect((await loadSettingsDraftFromDisk('en')).sidebarStyle).toBe('compact')
  })

  it('defaults missing preferences to full and includes style changes in the dirty signature', async () => {
    mocks.invoke.mockResolvedValue({ settings: {}, catalog: [] })
    const draft = await loadSettingsDraftFromDisk('en')
    expect(draft.sidebarStyle).toBe('full')
    expect(draftSignature({ ...draft, sidebarStyle: 'compact' })).not.toBe(draftSignature(draft))
  })
})
