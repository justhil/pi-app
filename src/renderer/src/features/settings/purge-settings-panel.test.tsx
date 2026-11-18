import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { defaultAgentPurgeConfig } from '@shared/agent-purge'
import i18n from '@renderer/lib/i18n'
import { PurgeSettingsPanel } from './purge-settings-panel'

const invokeMock = vi.fn((channel: string) => {
  if (channel === 'purge.getState') {
    return Promise.resolve({
      config: defaultAgentPurgeConfig(),
      purgedSessions: {},
      localDir: '/mock/.agent-purge/personas',
    })
  }
  return Promise.resolve({ ok: true, config: defaultAgentPurgeConfig() })
})

vi.mock('@renderer/lib/ipc-client', () => ({
  ipcClient: {
    invoke: (...args: unknown[]) => invokeMock(args[0] as string),
  },
}))

const INITIAL_LANG = i18n.language

describe('PurgeSettingsPanel', () => {
  afterEach(async () => {
    await act(async () => {
      await i18n.changeLanguage(INITIAL_LANG)
    })
  })

  it('renders built-in presets and allows creating a new custom persona', async () => {
    await act(async () => {
      await i18n.changeLanguage('zh')
    })
    render(<PurgeSettingsPanel />)

    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith('purge.getState'))
    expect(screen.queryByText(/大肥鱼/)).toBeNull()
    expect(screen.queryByText(/小码酱/)).toBeNull()
    expect(screen.queryByText(/YG/)).toBeNull()
    expect(screen.getAllByText(/泉此方/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/CTF/).length).toBeGreaterThan(0)

    const addButtons = screen.getAllByRole('button')
    const newBtn = addButtons.find((b) => b.textContent?.includes('新建人设') || b.textContent?.includes('New persona') || b.textContent?.includes('settings:purge.newPersona'))
    expect(newBtn).toBeDefined()
    fireEvent.click(newBtn!)
    expect(screen.getByDisplayValue(/custom-/)).toBeInTheDocument()
  })

  it('displays localized Konata Izumi name, description, and body without CJK in en and ru', async () => {
    await act(async () => {
      await i18n.changeLanguage('en')
    })
    const { container } = render(<PurgeSettingsPanel />)
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith('purge.getState'))

    expect(
      screen.getAllByDisplayValue('Konata Izumi · Sandbox execution').some((el) => el.tagName === 'INPUT'),
    ).toBe(true)
    const bodyTextarea = container.querySelector('textarea') as HTMLTextAreaElement
    expect(bodyTextarea.value).toContain('Konata Izumi')
    expect(bodyTextarea.value).not.toMatch(/[\u4e00-\u9fff]/)

    await act(async () => {
      await i18n.changeLanguage('ru')
    })
    expect(
      screen
        .getAllByDisplayValue('Коната Изуми · исполнение в песочнице')
        .some((el) => el.tagName === 'INPUT'),
    ).toBe(true)
    const ruBodyTextarea = container.querySelector('textarea') as HTMLTextAreaElement
    expect(ruBodyTextarea.value).toContain('Коната Изуми')
    expect(ruBodyTextarea.value).not.toMatch(/[\u4e00-\u9fff]/)
  })
})
