import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SkillsSettingsPanel } from './skills-settings-panel'

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  dirty: vi.fn(),
  register: vi.fn(),
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) => values ? `${key}:${JSON.stringify(values)}` : key,
  }),
}))

vi.mock('@renderer/lib/ipc-client', () => ({
  ipcClient: { invoke: mocks.invoke },
}))

vi.mock('@renderer/features/settings/use-settings-dirty-slice', () => ({
  useSettingsDirtySlice: mocks.register,
}))

vi.mock('@renderer/features/settings/settings-dirty-registry', () => ({
  notifySettingsDirtyChanged: mocks.dirty,
}))

const skill = {
  name: 'review',
  description: 'Review the current changes',
  path: '/skills/review/SKILL.md',
  source: 'user',
  key: 'host|/skills/review/SKILL.md|user',
  enabled: true,
  command: '/skill:review',
  effective: true,
  shadowed: false,
  editable: true,
  scope: 'user',
  origin: 'top-level',
}

beforeEach(() => {
  mocks.invoke.mockReset()
  mocks.dirty.mockReset()
  mocks.register.mockReset()
  mocks.invoke.mockImplementation((method: string) => {
    if (method === 'skills.list') return Promise.resolve({ complete: true, skills: [skill] })
    if (method === 'skills.description.write') return Promise.resolve({ ok: true })
    if (method === 'skills.transfer') return Promise.resolve({ ok: true })
    return Promise.resolve({ ok: true })
  })
})

describe('SkillsSettingsPanel', () => {
  it('uses progressive disclosure and labels the switch', async () => {
    render(<SkillsSettingsPanel />)

    const row = await screen.findByRole('button', { name: /review/i })
    expect(row).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByRole('switch')).toHaveAttribute('aria-label', 'settings:skills.disableSkill:{"name":"review"}')
    expect(screen.queryByLabelText('settings:skills.descriptionLabel')).not.toBeInTheDocument()

    fireEvent.click(row)
    expect(screen.getByLabelText('settings:skills.descriptionLabel')).toBeInTheDocument()
  })

  it('keeps unsaved toggles when the catalog is refreshed', async () => {
    render(<SkillsSettingsPanel />)

    const toggle = await screen.findByRole('switch')
    fireEvent.click(toggle)
    expect(toggle).not.toBeChecked()

    fireEvent.click(screen.getByRole('button', { name: 'common:refresh' }))
    await waitFor(() => expect(screen.getByRole('switch')).not.toBeChecked())
  })

  it('shows local success feedback after saving a description', async () => {
    render(<SkillsSettingsPanel />)
    fireEvent.click(await screen.findByRole('button', { name: /review/i }))
    fireEvent.change(screen.getByLabelText('settings:skills.descriptionLabel'), {
      target: { value: 'Review changes carefully' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'settings:skills.saveDescription' }))

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('settings:skills.descriptionSaved'))
    expect(mocks.invoke).toHaveBeenCalledWith('skills.description.write', {
      key: skill.key,
      description: 'Review changes carefully',
    })
  })

  it('saves enablement by opaque key without sending a path', async () => {
    render(<SkillsSettingsPanel />)
    fireEvent.click(await screen.findByRole('switch'))

    const registration = mocks.register.mock.calls.at(-1)?.[0]
    await registration.commit()

    expect(mocks.invoke).toHaveBeenCalledWith('skills.applyOverrides', {
      changes: [{ key: skill.key, enabled: false }],
    })
  })
})
