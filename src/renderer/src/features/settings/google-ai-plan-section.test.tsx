import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ipcClient } from '@renderer/lib/ipc-client'
import type { GoogleAiPlanStatus } from '@shared/ipc-contract'
import { GoogleAiPlanSection } from './google-ai-plan-section'

const appEventListeners = new Set<(event: { type: string }) => void>()

vi.mock('@renderer/lib/ipc-client', () => ({
  ipcClient: { invoke: vi.fn() },
  onAppEvent: (listener: (event: { type: string }) => void) => {
    appEventListeners.add(listener)
    return () => appEventListeners.delete(listener)
  },
}))

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn(), message: vi.fn() },
}))

vi.mock('@renderer/lib/available-models-cache', () => ({
  invalidateAvailableModels: vi.fn(),
  prefetchAvailableModels: vi.fn(),
}))

function makeStatus(overrides?: Partial<GoogleAiPlanStatus>): GoogleAiPlanStatus {
  return {
    prNumber: 12614,
    prUrl: 'https://github.com/earendil-works/pi/pull/12614',
    wslUnsupported: false,
    builtinInSdk: false,
    autoRemovedForBuiltinSdk: false,
    installed: false,
    managedByApp: false,
    extensionDir: 'C:\\Users\\test\\.pi\\agent\\extensions\\google-ai-plan',
    installedSha: null,
    fetchedAt: null,
    signedIn: false,
    expiresAt: null,
    models: [],
    login: { active: false, phase: 'idle' },
    ...overrides,
  }
}

beforeEach(() => {
  vi.mocked(ipcClient.invoke).mockReset()
  appEventListeners.clear()
})

afterEach(() => {
  cleanup()
})

describe('GoogleAiPlanSection', () => {
  it('renders preview state and triggers autoSync OAuth login on click', async () => {
    const initial = makeStatus()
    const awaiting = makeStatus({
      installed: true,
      managedByApp: true,
      installedSha: '628d2ccabbb9',
      models: [{ id: 'gemini-4-hydrogen', name: 'Gemini 4 Hydrogen' }],
      login: {
        active: true,
        phase: 'awaiting_callback',
        authUrl: 'https://accounts.google.com/o/oauth2/v2/auth?state=abc',
      },
    })

    vi.mocked(ipcClient.invoke).mockImplementation(async (method) => {
      if (method === 'googleAiPlan.status') return initial
      if (method === 'googleAiPlan.loginStart') return { ok: true, status: awaiting }
      return {}
    })

    render(<GoogleAiPlanSection />)

    const loginBtn = await screen.findByTestId('google-ai-plan-login-btn')
    expect(screen.getByTestId('google-ai-plan-sync-btn')).toBeInTheDocument()

    fireEvent.click(loginBtn)

    await waitFor(() => {
      expect(ipcClient.invoke).toHaveBeenCalledWith('googleAiPlan.loginStart', { autoSync: true })
    })
    expect(await screen.findByTestId('google-ai-plan-login-drawer')).toBeInTheDocument()
  })

  it('handles manual callback URL submission and refreshes parent on completion', async () => {
    const onChanged = vi.fn()
    const awaiting = makeStatus({
      installed: true,
      managedByApp: true,
      installedSha: '628d2cc',
      models: [{ id: 'gemini-4-hydrogen', name: 'Gemini 4 Hydrogen' }],
      login: {
        active: true,
        phase: 'awaiting_callback',
        authUrl: 'https://accounts.google.com/o/oauth2/v2/auth?state=abc',
      },
    })
    const signedIn = makeStatus({
      installed: true,
      managedByApp: true,
      installedSha: '628d2cc',
      signedIn: true,
      models: [
        { id: 'gemini-4-hydrogen', name: 'Gemini 4 Hydrogen' },
        { id: 'gemini-4-neon', name: 'Gemini 4 Neon' },
      ],
      login: { active: false, phase: 'succeeded' },
    })

    vi.mocked(ipcClient.invoke).mockImplementation(async (method) => {
      if (method === 'googleAiPlan.status') return awaiting
      if (method === 'googleAiPlan.loginSubmitUrl') return { ok: true, status: signedIn }
      return {}
    })

    render(<GoogleAiPlanSection onChanged={onChanged} />)

    const input = await screen.findByTestId('google-ai-plan-manual-input')
    fireEvent.change(input, { target: { value: 'http://127.0.0.1:4321/oauth2callback?code=123&state=abc' } })
    fireEvent.click(screen.getByTestId('google-ai-plan-manual-submit'))

    await waitFor(() => {
      expect(ipcClient.invoke).toHaveBeenCalledWith('googleAiPlan.loginSubmitUrl', {
        callbackUrl: 'http://127.0.0.1:4321/oauth2callback?code=123&state=abc',
      })
    })
    expect(await screen.findByTestId('google-ai-plan-logout-btn')).toBeInTheDocument()
    expect(onChanged).toHaveBeenCalled()
  })

  it('refreshes status when sdk-runtime-changed fires after browser OAuth callback completes', async () => {
    const onChanged = vi.fn()
    let current = makeStatus({
      installed: true,
      managedByApp: true,
      installedSha: '628d2cc',
      login: { active: true, phase: 'awaiting_callback', authUrl: 'https://accounts.google.com/o/oauth2/v2/auth' },
    })

    vi.mocked(ipcClient.invoke).mockImplementation(async (method) => {
      if (method === 'googleAiPlan.status') return current
      return {}
    })

    render(<GoogleAiPlanSection onChanged={onChanged} />)
    await screen.findByTestId('google-ai-plan-login-drawer')

    current = makeStatus({
      installed: true,
      managedByApp: true,
      installedSha: '628d2cc',
      signedIn: true,
      models: [{ id: 'gemini-4-hydrogen', name: 'Gemini 4 Hydrogen' }],
      login: { active: false, phase: 'succeeded' },
    })

    await act(async () => {
      for (const listener of appEventListeners) listener({ type: 'sdk-runtime-changed' })
    })

    expect(await screen.findByTestId('google-ai-plan-logout-btn')).toBeInTheDocument()
    expect(onChanged).toHaveBeenCalled()
  })

  it('hides extension sync button and shows auto-removed notice when SDK natively includes google-ai-plan', async () => {
    vi.mocked(ipcClient.invoke).mockResolvedValue(
      makeStatus({
        builtinInSdk: true,
        autoRemovedForBuiltinSdk: true,
        installed: false,
        signedIn: true,
      }),
    )

    render(<GoogleAiPlanSection />)

    expect(await screen.findByTestId('google-ai-plan-auto-removed-hint')).toBeInTheDocument()
    expect(screen.queryByTestId('google-ai-plan-sync-btn')).not.toBeInTheDocument()
    expect(screen.getByTestId('google-ai-plan-logout-btn')).toBeInTheDocument()
  })
})
