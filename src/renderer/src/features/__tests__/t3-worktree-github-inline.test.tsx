// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createSidebarShiftGuard } from '@renderer/lib/sidebar-shift-guard'
import { useExtensionUIStore } from '@renderer/stores/extension-ui-store'
import { useUIStore } from '@renderer/stores/ui-store'
import { ComposerInlineQuestionnaire } from '../extension-ui/composer-inline-questionnaire'
import { GitHubPanel } from '../github/github-panel'

const invokeMock = vi.fn<(...args: unknown[]) => Promise<unknown>>(async () => ({}))
vi.mock('@renderer/lib/ipc-client', () => ({
  ipcClient: { invoke: (...args: unknown[]) => invokeMock(...args) },
  onGitWorkspaceChanged: () => () => {},
}))

vi.mock('@renderer/lib/activate-workspace', () => ({
  activateWorkspace: vi.fn(async () => {}),
}))

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-i18next')>()
  return {
    ...actual,
    useTranslation: () => ({
      t: (k: string) => k,
    }),
  }
})

afterEach(() => {
  cleanup()
  invokeMock.mockReset()
  useExtensionUIStore.getState().clearAllDialogs()
  useExtensionUIStore.getState().setInlineHostMounted(false)
  useUIStore.setState({ currentWorkspace: null, historySessionFile: null, composerPrefill: null })
})

describe('Phase 1: Sidebar shift guard', () => {
  it('drops pointer presses on sidebar rows that shifted non-interactively within 500ms', () => {
    const container = document.createElement('div')
    const row = document.createElement('button')
    row.className = 'sidebar-session-row'
    let top = 40
    row.getBoundingClientRect = () => ({ top, bottom: top + 32, left: 0, right: 200, width: 200, height: 32, x: 0, y: top, toJSON: () => ({}) })
    container.appendChild(row)
    document.body.appendChild(container)

    const guard = createSidebarShiftGuard(container)
    // Simulate a background session arrival pushing this row down by 32px with no user input
    top = 72
    guard.update()

    const pd = new MouseEvent('pointerdown', { bubbles: true, cancelable: true })
    row.dispatchEvent(pd)
    expect(pd.defaultPrevented).toBe(true)

    guard.dispose()
    container.remove()
  })
})

describe('Phase 2: GitHubPanel', () => {
  it('lists PRs, opens detail, and hands off a PR prompt to Composer', async () => {
    useUIStore.setState({ currentWorkspace: '/repo' })
    const samplePr = {
      number: 146,
      title: 'Fix preview encoding',
      url: 'https://github.com/justhiL/pi-app/pull/146',
      state: 'open',
      isDraft: false,
      headRefName: 'fix/encoding',
      baseRefName: 'main',
      author: { login: 'alice' },
      updatedAt: new Date().toISOString(),
      checksState: 'failing',
      checks: [{ name: 'vitest', status: 'failed', description: '1 failed', url: 'https://ci.example/1' }],
      reviewDecision: null,
      mergeable: 'MERGEABLE',
      additions: 42,
      deletions: 7,
      changedFiles: 2,
      commentCount: 3,
      labels: [{ name: 'bug', color: 'd73a4a' }],
      body: 'Handles Shift_JIS correctly.',
    }
    invokeMock.mockImplementation(async (ch) => {
      if (ch === 'github.listPrs') {
        return {
          ok: true,
          repo: { host: 'github.com', owner: 'justhiL', repo: 'pi-app', fullName: 'justhiL/pi-app' },
          items: [samplePr],
        }
      }
      if (ch === 'github.prDetail') {
        return { ok: true, pr: samplePr }
      }
      return {}
    })

    render(<GitHubPanel />)
    await screen.findByText('Fix preview encoding')
    fireEvent.click(screen.getByText('Fix preview encoding'))

    await screen.findByText('vitest')
    fireEvent.click(screen.getByRole('button', { name: 'common:github.workLocal' }))

    await waitFor(() => {
      expect(useUIStore.getState().composerPrefill).toContain('#146')
    })
  })
})

describe('Phase 3: ComposerInlineQuestionnaire', () => {
  it('renders inline above composer, collapses/expands, and submits single-select answer', async () => {
    useExtensionUIStore.getState().enqueuePending({
      id: 'ask-inline-1',
      method: 'ask_user_question',
      questions: [
        {
          header: 'Scope',
          question: 'Which phase should we run?',
          options: [
            { label: 'All phases', description: 'Phase 1 + 2 + 3' },
            { label: 'Phase 1 only' },
          ],
        },
      ],
    })

    render(<ComposerInlineQuestionnaire />)
    expect(useExtensionUIStore.getState().inlineHostMounted).toBe(true)
    expect(screen.getByText('Which phase should we run?')).toBeInTheDocument()

    // Collapse to compact single line
    fireEvent.click(screen.getByText('common:github.inlineQuestionCollapse'))
    expect(screen.queryByText('All phases')).not.toBeInTheDocument()

    // Expand back and pick option
    fireEvent.click(screen.getByText('common:github.inlineQuestionExpand'))
    fireEvent.click(await screen.findByText('All phases'))

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith(
        'extension.respondUI',
        expect.objectContaining({
          id: 'ask-inline-1',
          result: expect.objectContaining({ cancelled: false }),
        }),
      )
    })
  })
})
