// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CanvasSurface } from '@shared/canvas-types'
import { useCanvasStore } from '../canvas-store'
import {
  computeSourceLineRange,
  formatCanvasPartialEditPrompt,
  type CanvasSelectionAnchor,
} from '../canvas-selection-popover'
import { SandboxHtmlSurface } from '../surfaces/sandbox-html-surface'
import { DiagramSurface } from '../surfaces/ui-block-surface'

const invokeMock = vi.fn<(...args: unknown[]) => Promise<unknown>>(async () => ({ ok: true }))
const sendPromptMock = vi.fn<(text: string) => Promise<boolean>>(async () => true)

vi.mock('@renderer/lib/ipc-client', () => ({
  ipcClient: { invoke: (...args: unknown[]) => invokeMock(...args) },
  onCanvasEvent: () => () => {},
}))

vi.mock('@renderer/lib/send-composer-prompt', () => ({
  sendComposerPrompt: (text: string) => sendPromptMock(text),
}))

describe('Canvas partial selection edit, offline React+Tailwind preview & PNG export', () => {
  beforeEach(() => {
    invokeMock.mockReset()
    sendPromptMock.mockReset()
    sendPromptMock.mockResolvedValue(true)
    useCanvasStore.setState({ surfaces: [], activeSurfaceId: null })
    // Simulate Electron preload presence for IPC paths.
    Object.defineProperty(window, 'piDesktop', {
      configurable: true,
      value: { invoke: invokeMock },
    })
  })

  it('computes exact 1-based line ranges and formats scoped partial-edit prompts cleanly', () => {
    const src = 'line 1\nconst title = "Old"\nconst sub = "Draft"\nline 4'
    expect(computeSourceLineRange(src, 'const title = "Old"\nconst sub = "Draft"')).toEqual({
      startLine: 2,
      endLine: 3,
    })

    const anchor: CanvasSelectionAnchor = {
      surfaceId: 'proto-card',
      surfaceTitle: 'Pricing Card',
      surfaceKind: 'html',
      anchorType: 'element',
      locationLabel: 'section.hero > button.cta',
      excerpt: 'Get Started',
      htmlSnippet: '<button class="cta">Get Started</button>',
      rect: { left: 100, top: 100, width: 120, height: 32 },
    }
    const prompt = formatCanvasPartialEditPrompt(anchor, '把按钮背景改成深灰色并加圆角')
    expect(prompt).toContain('surface: proto-card')
    expect(prompt).toContain('位置: section.hero > button.cta')
    expect(prompt).toContain('<button class="cta">Get Started</button>')
    expect(prompt).toContain('把按钮背景改成深灰色并加圆角')
    expect(prompt).toContain('canvas_update(id="proto-card")')
  })

  it('compiles React TSX prototypes offline, toggles element picker, and sends scoped element edit prompt', async () => {
    invokeMock.mockImplementation(async (channel: unknown) => {
      if (channel === 'canvas.prototype.compile') {
        return {
          ok: true,
          mode: 'react',
          compiledMain: 'exports.default = function App(){ return React.createElement("button", null, "Pay") }',
          compiledFiles: {},
          tailwindCss: '.p-4{padding:1rem}',
          lucideIcons: { Sparkles: [['path', { d: 'M0 0' }]] },
          runtimeJs: 'window.__PI_CANVAS_RUNTIME__ = {};',
          compileMs: 12,
          cached: false,
        }
      }
      return { ok: true }
    })

    const surface: CanvasSurface = {
      id: 'react-1',
      title: 'Checkout Widget',
      kind: 'html',
      source: 'ai',
      createdAt: 1,
      updatedAt: 1,
      payload: {
        mode: 'react',
        code: 'export default function App() { return <button className="p-4">Pay</button> }',
      },
    }
    useCanvasStore.setState({ surfaces: [surface], activeSurfaceId: 'react-1' })

    const { container } = render(<SandboxHtmlSurface surface={surface} />)

    await vi.waitFor(() => {
      const iframe = container.querySelector('iframe')
      const doc = iframe?.getAttribute('srcdoc') || ''
      expect(doc).toContain('.p-4{padding:1rem}')
      expect(doc).toContain('SandboxErrorBoundary')
      expect(doc).toContain('window.__PI_CANVAS_RUNTIME__')
    })

    const iframe = container.querySelector('iframe') as HTMLIFrameElement
    const postMessageSpy = vi.fn()
    const fakeWin = { postMessage: postMessageSpy } as unknown as Window
    Object.defineProperty(iframe, 'contentWindow', { configurable: true, value: fakeWin })

    // Toggle picker button -> sends picker-mode: true to sandbox iframe.
    fireEvent.click(screen.getByTitle('拾取页面元素发起局部修改'))
    expect(postMessageSpy).toHaveBeenCalledWith(
      { source: 'pi-canvas-host', type: 'picker-mode', enabled: true },
      '*',
    )

    // Sandbox reports picked DOM element -> Selection popover appears cleanly.
    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          source: fakeWin,
          data: {
            source: 'pi-canvas-sandbox',
            type: 'element-picked',
            detail: {
              selector: 'div#root > button.cta',
              tagName: 'button',
              text: 'Pay Now',
              html: '<button class="cta">Pay Now</button>',
              rect: { left: 40, top: 60, width: 100, height: 32 },
            },
          },
        }),
      )
    })

    const input = screen.getByPlaceholderText('输入对这一局部的修改指令，回车直发…')
    fireEvent.change(input, { target: { value: '把文字改成立即支付' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    await vi.waitFor(() => {
      expect(sendPromptMock).toHaveBeenCalledTimes(1)
    })
    const sent = sendPromptMock.mock.calls[0][0]
    expect(sent).toContain('div#root > button.cta')
    expect(sent).toContain('把文字改成立即支付')
    expect(sent).toContain('canvas_update(id="react-1")')
  })

  it('exports high-DPI 2x PNG from DiagramSurface through main-process svgToPng IPC', async () => {
    invokeMock.mockImplementation(async (channel: unknown) => {
      if (channel === 'canvas.svgToPng') {
        return { ok: true, data: btoa('fake-png-bytes'), mimeType: 'image/png', width: 640, height: 400 }
      }
      return { ok: true }
    })

    const createUrlSpy = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock-png')
    const revokeUrlSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})

    const surface: CanvasSurface = {
      id: 'diag-1',
      title: 'System Arch',
      kind: 'diagram',
      source: 'ai',
      createdAt: 1,
      updatedAt: 1,
      payload: {
        format: 'svg',
        code: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 200"><rect width="320" height="200"/></svg>',
      },
    }
    render(<DiagramSurface surface={surface} />)
    fireEvent.click(screen.getByTitle('导出高清 PNG (2x)'))

    await vi.waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith(
        'canvas.svgToPng',
        expect.objectContaining({ scale: 2, width: 320, height: 200 }),
      )
      expect(clickSpy).toHaveBeenCalled()
    })

    createUrlSpy.mockRestore()
    revokeUrlSpy.mockRestore()
    clickSpy.mockRestore()
  })
})
