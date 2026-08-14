import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { useUIStore } from '@renderer/stores/ui-store'

const scrollTo = vi.fn()
Element.prototype.scrollTo = scrollTo as never

const { invoke } = vi.hoisted(() => {
  const invoke = vi.fn(async (method: string) => {
    if (method === 'review.getDiff') {
      return {
        diff: {
          isRepo: true,
          status: ' M src/a.md\n M src/b.cpp\n',
          raw: [
            'diff --git a/src/a.md b/src/a.md',
            'index 000..111 100644',
            '--- a/src/a.md',
            '+++ b/src/a.md',
            '@@ -1 +1 @@',
            '-old-a',
            '+new-a',
            'diff --git a/src/b.cpp b/src/b.cpp',
            'index 000..222 100644',
            '--- a/src/b.cpp',
            '+++ b/src/b.cpp',
            '@@ -1 +1 @@',
            '-old-b',
            '+new-b',
          ].join('\n'),
          stagedRaw: '',
          branch: 'main',
        },
      }
    }
    return { ok: true }
  })
  return { invoke }
})

vi.mock('@renderer/lib/ipc-client', () => ({
  ipcClient: { invoke: (...args: unknown[]) => invoke(...(args as [string])) },
  onGitWorkspaceChanged: () => () => {},
}))

import { ReviewPanel } from '@renderer/features/review/review-panel'

function dispatchFocus(path: string) {
  act(() => {
    window.dispatchEvent(
      new CustomEvent('pi-desktop:review-scope', { detail: 'git' }),
    )
    window.dispatchEvent(
      new CustomEvent('pi-desktop:review-focus-file', { detail: { path } }),
    )
  })
}

describe('ReviewPanel focus switching between files', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useUIStore.setState({
      currentWorkspace: 'D:/proj',
      activePanel: 'review',
      panelOpenIntent: null,
      rightPanelCollapsed: false,
      rightPanelPrefs: { review: true, files: true, run: true },
      rightPanelCatalog: [
        { id: 'review', labelKey: 'p', fallbackLabel: 'Review', description: '', source: 'core' },
        { id: 'files', labelKey: 'f', fallbackLabel: 'Files', description: '', source: 'core' },
      ] as never,
      fileChanges: [],
      timelineItems: [],
    })
  })

  it('expands file B when focus moves from A to B (panel already mounted on git scope)', async () => {
    render(<ReviewPanel />)
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30))
    })

    // 先聚焦 A：A 的 diff 应展开
    dispatchFocus('src/a.md')
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10))
    })
    expect(screen.getByText('old-a')).toBeTruthy()
    expect(screen.getByText('new-a')).toBeTruthy()

    // 再聚焦 B：B 的 diff 应展开
    dispatchFocus('src/b.cpp')
    await act(async () => {
      await new Promise((r) => setTimeout(r, 60))
    })
    expect(screen.getByText('old-b')).toBeTruthy()
    expect(screen.getByText('new-b')).toBeTruthy()
    // 焦点跳转：目标文件应被滚动到面板中上位置（双 rAF 帧后触发）
    expect(scrollTo).toHaveBeenCalled()
  })

  it('shows full content for untracked added files and reveals absolute path in folder', async () => {
    invoke.mockImplementation(async (method: string) => {
      if (method === 'review.getDiff') {
        return {
          diff: {
            isRepo: true,
            status: '?? new.md\n',
            raw: '', // 未跟踪文件不在 git diff 输出里
            stagedRaw: '',
            branch: 'main',
          },
        }
      }
      if (method === 'workspace.fs.readText') {
        return { ok: true, content: 'line1\nline2\n' }
      }
      return { ok: true }
    })

    const { container } = render(<ReviewPanel />)
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30))
    })
    dispatchFocus('new.md')
    await act(async () => {
      await new Promise((r) => setTimeout(r, 60))
    })

    // 新增文件：展示全部内容（每行以 + 前缀渲染）
    expect(screen.getByText('line1')).toBeTruthy()
    expect(screen.getByText('line2')).toBeTruthy()

    // “在文件夹显示”传绝对路径
    const revealBtn = container.querySelector('button[title="在文件夹显示"]')
    expect(revealBtn).not.toBeNull()
    fireEvent.click(revealBtn!)
    expect(invoke).toHaveBeenCalledWith('shell.showItemInFolder', {
      path: 'D:/proj/new.md',
    })
  })
})
