// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AdapterJson } from '@extension-compat/adapter-schema'
import { AdaptedExtensionsInstaller } from './adapted-extensions-installer'

const invokeMock = vi.hoisted(() => vi.fn())

const MOCK_ADAPTERS: AdapterJson[] = [
  {
    id: '@juicesharp/rpiv-ask-user-question',
    displayName: 'Ask User Question',
    description: 'Structured questionnaire dialog',
    tier: 'native',
    match: { names: ['@juicesharp/rpiv-ask-user-question'] },
    install: {
      source: 'npm:@juicesharp/rpiv-ask-user-question',
      homepage: 'https://github.com/juicesharp/rpiv-mono',
    },
    interact: { trigger: { tool: 'ask_user_question' }, schema: 'questions' },
  },
  {
    id: '@bytetrue/pi-background-terminal',
    displayName: 'Background Terminal',
    description: 'Background commands & live terminal follower',
    tier: 'native',
    match: { names: ['@bytetrue/pi-background-terminal'] },
    install: {
      source: 'npm:@bytetrue/pi-background-terminal',
      homepage: 'https://github.com/ByteTrue/pi-package-mono',
    },
    statusBar: { protocol: 'background-jobs-v1', tools: ['background_run'] },
  },
  {
    id: 'trellis',
    displayName: 'Trellis',
    tier: 'native',
    match: { names: ['trellis'] },
    // Intentionally omits `install` -> must stay hidden from quick install
  },
  {
    id: 'pi-continue',
    displayName: 'Continue',
    tier: 'headless',
    match: { names: ['pi-continue'] },
    // Deprecated -> omits `install` -> must stay hidden
  },
]

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-i18next')>()
  return {
    ...actual,
    useTranslation: () => ({
      t: (k: string, opts?: Record<string, unknown>) =>
        opts?.count !== undefined
          ? `${k}:${opts.count}`
          : opts?.installed !== undefined
            ? `${k}:${opts.installed}/${opts.total}`
            : k,
      i18n: { language: 'zh' },
    }),
  }
})

vi.mock('@renderer/lib/ipc-client', () => ({
  ipcClient: { invoke: invokeMock },
}))

vi.mock('@renderer/lib/adapter-catalog', () => ({
  useAdapterCatalog: () => ({
    adapters: MOCK_ADAPTERS,
    errors: [],
    sources: {},
  }),
  invalidateAdapterSnapshots: vi.fn(),
}))

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

describe('AdaptedExtensionsInstaller UI', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(cleanup)

  it('renders collapsed by default, filters out adapters without install.source, marks installed ones, and runs one-click install', async () => {
    const onInstalled = vi.fn()
    invokeMock.mockResolvedValue({ ok: true, source: 'npm:@bytetrue/pi-background-terminal' })

    render(
      <AdaptedExtensionsInstaller
        workspaceId="/proj"
        extensions={[
          {
            id: 'ext-1',
            name: '@juicesharp/rpiv-ask-user-question',
            adapterId: '@juicesharp/rpiv-ask-user-question',
          },
        ]}
        onInstalled={onInstalled}
      />,
    )

    // Default collapsed: list rows not mounted
    const toggle = screen.getByTestId('adapted-extensions-toggle')
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(
      screen.queryByTestId('adapted-ext-row-@bytetrue/pi-background-terminal'),
    ).not.toBeInTheDocument()

    // Expand
    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByTestId('adapted-ext-row-@bytetrue/pi-background-terminal')).toBeInTheDocument()

    // Non-A adapters without install.source stay hidden
    expect(screen.queryByTestId('adapted-ext-row-trellis')).not.toBeInTheDocument()
    expect(screen.queryByTestId('adapted-ext-row-pi-continue')).not.toBeInTheDocument()

    // Already-installed plugin shows installed badge
    expect(
      screen.getByTestId('adapted-ext-installed-@juicesharp/rpiv-ask-user-question'),
    ).toBeInTheDocument()

    // Click one-click install on uninstalled plugin
    fireEvent.click(screen.getByTestId('adapted-ext-install-@bytetrue/pi-background-terminal'))
    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('extensions.install', {
        adapterId: '@bytetrue/pi-background-terminal',
        scope: 'global',
        workspaceId: '/proj',
      })
    })
    expect(onInstalled).toHaveBeenCalledTimes(1)
    expect(
      screen.getByTestId('adapted-ext-installed-@bytetrue/pi-background-terminal'),
    ).toBeInTheDocument()
  })
})
