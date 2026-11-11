import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { defaultAgentPurgeConfig } from '@shared/agent-purge'
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

describe('PurgeSettingsPanel', () => {
  it('renders built-in presets and allows creating a new custom persona', async () => {
    render(<PurgeSettingsPanel />)

    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith('purge.getState'))
    expect(screen.getAllByText(/大肥鱼/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/小码酱/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/CTF/).length).toBeGreaterThan(0)

    const addButtons = screen.getAllByRole('button')
    const newBtn = addButtons.find((b) => b.textContent?.includes('新建人设') || b.textContent?.includes('New persona') || b.textContent?.includes('settings:purge.newPersona'))
    expect(newBtn).toBeDefined()
    fireEvent.click(newBtn!)
    expect(screen.getByDisplayValue(/custom-/)).toBeInTheDocument()
  })
})
