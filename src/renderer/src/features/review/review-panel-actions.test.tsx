import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useUIStore } from '@renderer/stores/ui-store'
import { ReviewPanel } from './review-panel'
import { listAllReviewComments, upsertReviewComment } from './review-inline-comments'

const mocks = vi.hoisted(() => ({
  send: vi.fn(),
  gitData: { isRepo: true, branch: 'main', status: '', raw: '', stagedRaw: '' } as {
    isRepo: boolean
    branch: string
    status: string
    raw: string
    stagedRaw: string
  },
}))
vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-i18next')>()),
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      opts && 'count' in opts ? `${key}:${opts.count}` : key,
  }),
}))
vi.mock('@renderer/lib/send-composer-prompt', () => ({ sendComposerPrompt: mocks.send }))
vi.mock('./use-review-git-data', () => ({
  useReviewGitData: () => ({
    gitData: mocks.gitData,
    loading: false,
    refreshing: false,
    refresh: vi.fn(),
  }),
}))

beforeEach(() => {
  localStorage.clear()
  mocks.send.mockReset()
  mocks.gitData = { isRepo: true, branch: 'main', status: '', raw: '', stagedRaw: '' }
  useUIStore.setState({ currentWorkspace: '/project', fileChanges: [], timelineItems: [] })
})

describe('Review action area', () => {
  it('updates the comment action immediately without reloading the panel', () => {
    render(<ReviewPanel />)
    expect(screen.queryByRole('button', { name: /review:sendComments/ })).not.toBeInTheDocument()
    act(() => { upsertReviewComment('/project', { filePath: 'a.ts', hunkIndex: 0, lineIndex: 1, text: 'Please rename this' }) })
    expect(screen.getByRole('button', { name: /review:sendComments/ })).toHaveTextContent('1')
  })

  it('preserves comments on failed sending and clears them after successful sending', async () => {
    upsertReviewComment('/project', { filePath: 'a.ts', hunkIndex: 0, lineIndex: 1, text: 'Please rename this' })
    mocks.send.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(true)
    render(<ReviewPanel />)
    fireEvent.click(screen.getByRole('button', { name: /review:sendComments/ }))
    expect(await screen.findByRole('alert')).toHaveTextContent('review:sendFailed')
    expect(listAllReviewComments('/project')).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: /review:sendComments/ }))
    await waitFor(() => expect(listAllReviewComments('/project')).toHaveLength(0))
  })

  it('should_keep_unsent_or_edited_comments_when_a_send_is_pending', async () => {
    const original = upsertReviewComment('/project', { filePath: 'a.ts', hunkIndex: 0, lineIndex: 1, text: 'Original comment' })
    let finish!: (value: boolean) => void
    mocks.send.mockImplementationOnce(() => new Promise<boolean>(resolve => { finish = resolve }))
    render(<ReviewPanel />)
    fireEvent.click(screen.getByRole('button', { name: /review:sendComments/ }))
    act(() => {
      upsertReviewComment('/project', { filePath: 'b.ts', hunkIndex: 0, lineIndex: 2, text: 'New unsent comment' })
      upsertReviewComment('/project', { ...original, text: 'Edited while sending' })
    })
    await act(async () => finish(true))
    expect(listAllReviewComments('/project').map(row => row.text)).toEqual(['Edited while sending', 'New unsent comment'])
  })

  it('makes scope selection explicit and no longer offers commit / message generation', () => {
    render(<ReviewPanel />)
    const git = screen.getByRole('button', { name: 'review:scope.git' })
    fireEvent.click(git)
    expect(git).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByRole('button', { name: /generate|commit/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })

  it('should_count_codemode_modified_files_and_dedupe_staged_plus_unstaged_files_in_session_scope', () => {
    mocks.gitData = {
      isRepo: true,
      branch: 'main',
      status: 'MM src/cm.ts\n',
      stagedRaw: 'diff --git a/src/cm.ts b/src/cm.ts\n--- a/src/cm.ts\n+++ b/src/cm.ts\n@@ -1 +1,3 @@\n a\n+b\n+c\n',
      raw: 'diff --git a/src/cm.ts b/src/cm.ts\n--- a/src/cm.ts\n+++ b/src/cm.ts\n@@ -1,3 +1,4 @@\n-a\n+x\n+y\n b\n c\n',
    }
    useUIStore.setState({
      currentWorkspace: '/project',
      fileChanges: [],
      timelineItems: [
        {
          id: 'cm-review-1',
          type: 'tool-call',
          toolName: 'codemode',
          toolPhase: 'end',
          runId: 'run-1',
          toolArgs: { code: 'await tools.edit({ path: "src/cm.ts", edits: [] })' },
          toolDetails: {
            calls: [
              { id: 'cm-review-1/1', name: 'edit', args: '{"path":"src/cm.ts"}', status: 'ok' },
            ],
          },
          timestamp: 1,
        },
      ],
    })

    render(<ReviewPanel />)
    expect(screen.getByText('review:scopeHintSession:1')).toBeInTheDocument()
    expect(screen.getByText('+4')).toBeInTheDocument()
    expect(screen.getAllByText('−1').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByRole('button', { name: 'review:scope.session' })).toHaveTextContent('1')
  })
})
