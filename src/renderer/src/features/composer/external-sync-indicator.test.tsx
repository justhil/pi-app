import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ExternalSyncIndicator } from './external-sync-indicator'
import { useUIStore } from '@renderer/stores/ui-store'
import { reloadCurrentSessionData } from '@renderer/lib/reload-current-session-data'

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-i18next')>()
  return {
    ...actual,
    useTranslation: () => ({ t: (key: string) => key }),
  }
})

vi.mock('@renderer/lib/reload-current-session-data', () => ({
  reloadCurrentSessionData: vi.fn(async () => ({ ok: true })),
}))

function setPhase(phase: 'idle' | 'active' | 'error'): void {
  useUIStore.getState().setExternalSyncPhase(phase)
}

beforeEach(() => {
  useUIStore.setState({ externalSyncPhase: 'idle' })
  vi.clearAllMocks()
})

describe('ExternalSyncIndicator', () => {
  it('renders nothing when idle', () => {
    setPhase('idle')
    render(<ExternalSyncIndicator />)
    expect(document.body.textContent).toBe('')
  })

  it('shows the active syncing pill when an external conversation is being written', () => {
    setPhase('active')
    render(<ExternalSyncIndicator />)
    expect(screen.getByText('common:composer.externalSyncActive')).toBeTruthy()
  })

  it('shows the error pill with a retry action when sync fails', () => {
    setPhase('error')
    render(<ExternalSyncIndicator />)
    const btn = screen.getByText('common:composer.externalSyncError')
    btn.click()
    expect(reloadCurrentSessionData).toHaveBeenCalledOnce()
  })
})
