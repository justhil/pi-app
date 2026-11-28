// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CanvasSurface } from '@shared/canvas-types'
import { useUIStore } from '@renderer/stores/ui-store'
import type { SessionItem, TimelineItem } from '@renderer/stores/ui-store-types'
import { useCanvasStore } from '../canvas-store'
import { CanvasPanel } from '../canvas-panel'
import { MarkdownSurface } from '../surfaces/ui-block-surface'
import { SandboxHtmlSurface } from '../surfaces/sandbox-html-surface'
import { ImageSurface } from '../surfaces/image-surface'
import { buildLiveDelegationNodes } from '../surfaces/delegation-tree-surface'

const invokeMock = vi.fn<(...args: unknown[]) => Promise<unknown>>(async () => ({ ok: true }))
vi.mock('@renderer/lib/ipc-client', () => ({
  ipcClient: { invoke: (...args: unknown[]) => invokeMock(...args) },
  onCanvasEvent: () => () => {},
}))

describe('Canvas enhanced surfaces & panel behavior', () => {
  beforeEach(() => {
    invokeMock.mockReset()
    invokeMock.mockResolvedValue({ ok: true })
    useCanvasStore.setState({
      surfaces: [],
      activeSurfaceId: null,
      layoutMode: 'single',
      showAllSessions: false,
      protocolDrawerOpen: false,
    })
    useUIStore.setState({
      historySessionFile: '/sessions/a.jsonl',
      browserChatExpand: false,
      canvasChatExpand: false,
      filesPreviewChatExpand: false,
    })
  })

  it('renders MarkdownSurface with real MarkdownView (headings, bold, inline code) instead of raw <pre>', async () => {
    await import('@renderer/features/timeline/markdown-view')
    const surface: CanvasSurface = {
      id: 'md-1',
      title: 'Design Spec',
      kind: 'markdown',
      source: 'ai',
      createdAt: 1,
      updatedAt: 1,
      payload: { markdown: '# System Plan\n\nUse **real** `MarkdownView`.' },
    }
    const { container } = render(<MarkdownSurface surface={surface} />)
    await vi.waitFor(() => {
      expect(container.querySelector('h1')?.textContent).toBe('System Plan')
    })
    expect(container.querySelector('strong')?.textContent).toBe('real')
    expect(container.querySelector('code')?.textContent).toBe('MarkdownView')

    // Toggling source switches to raw source view cleanly.
    fireEvent.click(screen.getByTitle('查看源码'))
    expect(container.querySelector('pre')?.textContent).toContain('# System Plan')
  })

  it('enforces strict iframe source isolation, captures runtime errors, and preserves srcDoc across theme changes', () => {
    const surface: CanvasSurface = {
      id: 'html-1',
      title: 'Widget',
      kind: 'html',
      source: 'ai',
      createdAt: 1,
      updatedAt: 1,
      payload: { html: '<button id="go">Go</button>' },
    }
    useCanvasStore.setState({ surfaces: [surface], activeSurfaceId: 'html-1' })

    const { container } = render(<SandboxHtmlSurface surface={surface} />)
    const iframe = container.querySelector('iframe') as HTMLIFrameElement
    expect(iframe).not.toBeNull()
    const initialSrcDoc = iframe.getAttribute('srcdoc')

    const postMsgSpy = vi.fn()
    const fakeContentWindow = { postMessage: postMsgSpy } as unknown as Window
    Object.defineProperty(iframe, 'contentWindow', { configurable: true, value: fakeContentWindow })

    // Spoofed message from another window must be ignored (no cross-surface leakage).
    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          source: {} as Window,
          data: { source: 'pi-canvas-sandbox', type: 'click', detail: { evil: true } },
        }),
      )
    })
    expect(useCanvasStore.getState().surfaces[0].interactionState).toBeUndefined()

    // Genuine runtime error from THIS iframe is captured into interactionState and shown in diagnostics bar.
    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          source: fakeContentWindow,
          data: { source: 'pi-canvas-sandbox', type: 'runtime-error', detail: { message: 'ReferenceError: foo', line: 12 } },
        }),
      )
    })
    expect(screen.getByText(/ReferenceError: foo/)).toBeInTheDocument()
    const savedErrors = (useCanvasStore.getState().surfaces[0].interactionState as { runtimeErrors?: unknown[] })?.runtimeErrors
    expect(savedErrors).toHaveLength(1)

    // Theme class mutation hot-pushes CSS variables via postMessage without resetting srcDoc!
    act(() => {
      document.documentElement.classList.toggle('dark')
    })
    expect(iframe.getAttribute('srcdoc')).toBe(initialSrcDoc)
    document.documentElement.classList.remove('dark')
  })

  it('renders ImageSurface in compare slider mode with before/after labels', () => {
    const surface: CanvasSurface = {
      id: 'img-cmp',
      title: 'Before vs After',
      kind: 'image',
      source: 'ai',
      createdAt: 1,
      updatedAt: 1,
      payload: {
        mode: 'compare',
        src: 'data:image/png;base64,AAA',
        compareSrc: 'data:image/png;base64,BBB',
        leftLabel: 'Old UI',
        rightLabel: 'New UI',
      },
    }
    render(<ImageSurface surface={surface} />)
    expect(screen.getByText('Old UI')).toBeInTheDocument()
    expect(screen.getByText('New UI')).toBeInTheDocument()
  })

  it('builds multi-level delegation trees with chain steps and nested child subagent sessions', () => {
    const timeline: TimelineItem[] = [
      {
        id: 'tc-1',
        type: 'tool-call',
        toolCallId: 'call-chain',
        toolName: 'subagent',
        toolPhase: 'end',
        toolArgs: { chain: [{ agent: 'worker-a', task: 'step one' }, { agent: 'worker-b', task: 'step two' }] },
        toolDetails: {
          mode: 'chain',
          results: [
            { agent: 'worker-a', task: 'step one', status: 'completed', sessionFile: '/sessions/child-a.jsonl', exitCode: 0 },
            { agent: 'worker-b', task: 'step two', status: 'completed', sessionFile: '/sessions/child-b.jsonl', exitCode: 0 },
          ],
        },
        timestamp: 1000,
      } as unknown as TimelineItem,
    ]
    const sessions: SessionItem[] = [
      {
        sessionId: 'grand-1',
        sessionFile: '/sessions/grand-1.jsonl',
        parentSessionFile: '/sessions/child-a.jsonl',
        title: 'Grandchild Scout',
        firstMessage: 'Inspect sub-module',
      } as SessionItem,
    ]

    const nodes = buildLiveDelegationNodes(timeline, sessions, '/sessions/root.jsonl')
    const chainBatch = nodes.find((n) => n.kind === 'batch')
    const stepOne = nodes.find((n) => n.agent === 'worker-a')
    const grandchild = nodes.find((n) => n.agent === 'Grandchild Scout')

    expect(chainBatch).toBeDefined()
    expect(stepOne?.parentId).toBe(chainBatch?.id)
    expect(stepOne?.stepIndex).toBe(1)
    expect(grandchild?.parentId).toBe(stepOne?.id)
  })

  it('mounts zero-token live delegation tree from empty state and toggles independent canvasChatExpand', () => {
    render(<CanvasPanel />)
    fireEvent.click(screen.getByRole('button', { name: '实时委派树' }))
    expect(useCanvasStore.getState().surfaces).toHaveLength(1)
    expect(useCanvasStore.getState().surfaces[0]).toMatchObject({
      kind: 'delegation-tree',
      source: 'user',
    })

    // Add a second surface so the multi-tab header renders, then test Pin & independent canvasChatExpand.
    act(() => {
      useCanvasStore.getState().presentSurface({
        id: 'note-2',
        title: 'Note',
        kind: 'markdown',
        sessionFile: '/sessions/a.jsonl',
        payload: { markdown: 'hi' },
      })
    })
    fireEvent.click(screen.getByTitle('全宽查看'))
    expect(useUIStore.getState().canvasChatExpand).toBe(true)
    expect(useUIStore.getState().browserChatExpand).toBe(false)

    fireEvent.click(screen.getByLabelText('置顶 Note'))
    expect(useCanvasStore.getState().surfaces.find((s) => s.id === 'note-2')?.pinned).toBe(true)
  })
})
