// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useCanvasStore } from '@renderer/features/canvas/canvas-store'
import { clearBlockStateForTests } from '../block-state'
import UIBlockRuntime from '../runtime'

const sendPromptMock = vi.fn<(text: string) => Promise<boolean>>(async () => true)
vi.mock('@renderer/lib/send-composer-prompt', () => ({
  sendComposerPrompt: (text: string) => sendPromptMock(text),
}))

describe('pi-ui V2 Live Panel, new components & enhanced charts', () => {
  beforeEach(() => {
    clearBlockStateForTests()
    sendPromptMock.mockReset()
    sendPromptMock.mockResolvedValue(true)
    useCanvasStore.setState({ surfaces: [], activeSurfaceId: null })
  })

  it('renders an interactive Live Panel where slider updates stat, formula, SVG scene and editable ask prompt', async () => {
    const raw = JSON.stringify({
      component: 'panel',
      id: 'gravity-demo',
      title: '重力演示',
      state: { m: 10, g: 10 },
      computed: { f: 'm * g' },
      children: [
        { component: 'formula', name: 'F', expr: 'm * g', unit: 'N', precision: 0 },
        { component: 'slider', bind: 'm', label: '质量', min: 1, max: 30, unit: 'kg' },
        { component: 'stat', label: '合力', value: '{f}', unit: 'N' },
        {
          component: 'scene',
          width: 240,
          height: 180,
          shapes: [{ type: 'rect', x: 80, y: 20, w: 80, h: 40, label: '{m} kg', tone: 'info' }],
        },
        { component: 'button', ask: '当质量为 {m} kg 时合力是多少？' },
      ],
    })

    const { container } = render(<UIBlockRuntime raw={raw} streaming={false} />)
    expect(screen.getByText('重力演示')).toBeInTheDocument()
    expect(container.querySelector('.uib-stat-value')?.textContent).toContain('100')
    expect(container.querySelector('.uib-live-formula-worked')?.textContent).toContain('100')
    expect(container.querySelector('.uib-scene-svg text')?.textContent).toBe('10 kg')

    const slider = screen.getByLabelText('质量') as HTMLInputElement
    fireEvent.change(slider, { target: { value: '20' } })

    expect(container.querySelector('.uib-stat-value')?.textContent).toContain('200')
    expect(container.querySelector('.uib-live-formula-worked')?.textContent).toContain('200')
    expect(container.querySelector('.uib-scene-svg text')?.textContent).toBe('20 kg')

    // Ask bar tracks updated template and sends on click
    const askField = screen.getByLabelText('编辑并发送追问') as HTMLTextAreaElement
    expect(askField.value).toBe('当质量为 20 kg 时合力是多少？')
    fireEvent.click(screen.getByLabelText('发送追问'))
    await vi.waitFor(() => {
      expect(sendPromptMock).toHaveBeenCalledWith('当质量为 20 kg 时合力是多少？')
    })

    // Reset button restores initial state
    fireEvent.click(screen.getByRole('button', { name: '重置' }))
    expect(container.querySelector('.uib-stat-value')?.textContent).toContain('100')
  })

  it('streams Live Panel containers progressively while keeping unfinished leaf nodes as placeholders', () => {
    const partial =
      '{"component":"panel","id":"stream-live","title":"流式面板","state":{"x":5},"children":[{"component":"text","text":"已完成节点"},{"component":"stat","label":"正在打字'
    render(<UIBlockRuntime raw={partial} streaming={true} />)
    expect(screen.getByText('流式面板')).toBeInTheDocument()
    expect(screen.getByText('已完成节点')).toBeInTheDocument()
  })

  it('supports flat top-level props and opens any block in the right-side AI Canvas', () => {
    const raw = JSON.stringify({
      component: 'stat-grid',
      id: 'latency-kpi',
      title: '延迟指标',
      items: [{ label: 'P99 延迟', value: '42', unit: 'ms', delta: '-18ms', trend: 'down', tone: 'positive' }],
    })
    const { container } = render(<UIBlockRuntime raw={raw} streaming={false} />)
    expect(screen.getByText('P99 延迟')).toBeInTheDocument()
    // tone: 'positive' colours negative delta green ('up') while keeping downward arrow
    expect(container.querySelector('.uib-delta')?.getAttribute('data-trend')).toBe('up')

    fireEvent.click(screen.getByRole('button', { name: '在画布打开' }))
    expect(useCanvasStore.getState().surfaces).toHaveLength(1)
    expect(useCanvasStore.getState().surfaces[0]).toMatchObject({
      kind: 'ui-block',
      title: '延迟指标',
    })
  })

  it('renders native SVG radar, funnel, radial, and 100% stacked percent charts cleanly', () => {
    for (const type of ['radar', 'funnel', 'radial'] as const) {
      const raw = JSON.stringify({
        component: 'chart',
        id: `c-${type}`,
        title: `Chart ${type}`,
        type,
        x: ['A', 'B', 'C', 'D'],
        series: [{ name: 'Score', data: [90, 70, 50, 30] }],
      })
      const { container, unmount } = render(<UIBlockRuntime raw={raw} streaming={false} />)
      expect(container.querySelector('svg')).not.toBeNull()
      unmount()
    }

    const percentBar = JSON.stringify({
      component: 'chart',
      id: 'c-pct',
      type: 'bar',
      stacked: true,
      percent: true,
      x: ['Q1', 'Q2'],
      series: [
        { name: 'Desktop', data: [60, 40] },
        { name: 'Mobile', data: [40, 60] },
      ],
    })
    const { container } = render(<UIBlockRuntime raw={percentBar} streaming={false} />)
    expect(container.querySelectorAll('rect').length).toBeGreaterThan(0)
  })

  it('renders function-plot with explicit and implicit curves and image-gallery with lightbox', () => {
    const plotRaw = JSON.stringify({
      component: 'function-plot',
      id: 'fp-1',
      title: '圆与正弦',
      functions: [{ expr: 'y = sin(x)' }, { expr: 'x^2 + y^2 = 9' }],
    })
    const { container: plotC } = render(<UIBlockRuntime raw={plotRaw} streaming={false} />)
    expect(plotC.querySelectorAll('.uib-fplot-svg path').length).toBe(2)

    const galleryRaw = JSON.stringify({
      component: 'image-gallery',
      id: 'ig-1',
      title: '截图对比',
      images: [
        { src: 'data:image/png;base64,AAAA', alt: 'Shot 1', caption: '第一张' },
        { src: 'javascript:alert(1)', alt: 'Blocked' },
        { src: 'data:image/png;base64,BBBB', alt: 'Shot 2', caption: '第二张' },
      ],
    })
    render(<UIBlockRuntime raw={galleryRaw} streaming={false} />)
    expect(screen.getByText('第一张')).toBeInTheDocument()
    expect(screen.queryByAltText('Blocked')).toBeNull()
    fireEvent.click(screen.getByAltText('Shot 1'))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('supports branching quiz options jumping by question id and early termination with next:end', () => {
    const quizRaw = JSON.stringify({
      component: 'quiz',
      id: 'branch-quiz',
      title: '排障向导',
      questions: [
        {
          id: 'q1',
          question: '服务启动了吗？',
          options: [
            { text: '已启动', next: 'q3', explanation: '跳过安装步骤' },
            { text: '未启动', next: 'end' },
          ],
        },
        { id: 'q2', question: '不应该跳到这题', options: ['A', 'B'] },
        { id: 'q3', question: '端口占用吗？', options: ['是', '否'] },
      ],
    })
    render(<UIBlockRuntime raw={quizRaw} streaming={false} />)
    fireEvent.click(screen.getByText('已启动'))
    expect(screen.getByText('跳过安装步骤')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /下一题|next/i }))
    expect(screen.getByText('端口占用吗？')).toBeInTheDocument()
  })
})
