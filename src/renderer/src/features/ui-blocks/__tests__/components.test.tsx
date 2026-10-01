import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import i18n from '@renderer/lib/i18n'
import { clearBlockStateForTests } from '../block-state'
import { parseUIBlock } from '../envelope'
import { UI_BLOCK_REGISTRY } from '../registry'
import UIBlockRuntime from '../runtime'
import { validate } from '../schema'

const EXAMPLES_PATH = resolve(process.cwd(), 'doc/guide/pi-ui-examples.md')

/** Every ```pi-ui fence in the skill's example file, keyed by the envelope id. */
function loadExamples(): Map<string, string> {
  const text = readFileSync(EXAMPLES_PATH, 'utf8')
  const blocks = new Map<string, string>()
  for (const match of text.matchAll(/```pi-ui\n([\s\S]*?)\n```/g)) {
    const id = /"id":\s*"([^"]+)"/.exec(match[1])?.[1] ?? String(blocks.size)
    blocks.set(id, match[1])
  }
  return blocks
}

const examples = loadExamples()
const example = (id: string) => {
  const raw = examples.get(id)
  if (!raw) throw new Error(`missing example ${id}`)
  return raw
}

beforeAll(async () => {
  await i18n.changeLanguage('en')
})

beforeEach(() => clearBlockStateForTests())

describe('skill examples', () => {
  it('covers every registered component', () => {
    const used = new Set([...examples.values()].map((raw) => /"component":\s*"([^"]+)"/.exec(raw)?.[1]))
    for (const name of UI_BLOCK_REGISTRY.keys()) expect(used.has(name), name).toBe(true)
  })

  it.each([...examples.entries()])('%s parses and validates', (_id, raw) => {
    const parsed = parseUIBlock(raw, false)
    expect(parsed.status).toBe('ok')
    if (parsed.status !== 'ok') return
    const definition = UI_BLOCK_REGISTRY.get(parsed.envelope.component)!
    const result = validate(definition.schema, parsed.envelope.props)
    expect(result.ok ? [] : result.issues).toEqual([])
  })

  it.each([...examples.entries()])('%s renders without falling back', (_id, raw) => {
    const { container } = render(<UIBlockRuntime raw={raw} streaming={false} />)
    expect(container.querySelector('.uib-fallback')).toBeNull()
    expect(container.querySelector('.uib-root .uib-frame')).not.toBeNull()
  })
})

describe('fallbacks', () => {
  it('shows a skeleton while the JSON is still streaming', () => {
    const { container } = render(<UIBlockRuntime raw={'{"component":"chart","props":{"series":[{"na'} streaming />)
    expect(container.querySelector('.uib-skeleton[data-kind="chart"]')).toHaveAttribute('aria-busy', 'true')
  })

  it('explains invalid JSON and exposes the source', () => {
    render(<UIBlockRuntime raw={'{"component":"chart","props":{"type":}'} streaming={false} />)
    expect(screen.getByText('Structured content could not be rendered')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Show source' }))
    expect(screen.getByText('{"component":"chart","props":{"type":}')).toBeInTheDocument()
  })

  it('names unknown components and invalid props', () => {
    const { unmount } = render(<UIBlockRuntime raw={'{"component":"globe","props":{}}'} streaming={false} />)
    expect(screen.getByText('Unknown component')).toBeInTheDocument()
    unmount()
    render(<UIBlockRuntime raw={'{"component":"chart","props":{"type":"radar","series":[]}}'} streaming={false} />)
    expect(screen.getByText(/type: expected one of/)).toBeInTheDocument()
  })
})

describe('interactions', () => {
  it('sorts the data table and keeps the order across remounts', () => {
    const raw = example('dep-audit')
    const first = render(<UIBlockRuntime raw={raw} streaming={false} />)
    const firstCell = () => screen.getAllByRole('row')[1].querySelector('td')?.textContent
    expect(firstCell()).toBe('react-dom')
    fireEvent.click(screen.getByRole('button', { name: /体积/ }))
    expect(firstCell()).toBe('zustand')
    fireEvent.click(screen.getByRole('button', { name: /体积/ }))
    expect(firstCell()).toBe('katex')
    first.unmount()
    render(<UIBlockRuntime raw={raw} streaming={false} />)
    expect(firstCell()).toBe('katex')
  })

  it('grades single and multi-select quiz answers', () => {
    render(<UIBlockRuntime raw={example('js-event-loop')} streaming={false} />)
    fireEvent.click(screen.getByRole('radio', { name: /微任务/ }))
    expect(screen.getByText('Correct')).toBeInTheDocument()
    expect(screen.getByText(/then\/catch\/finally/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('checkbox', { name: /setTimeout/ }))
    fireEvent.click(screen.getByRole('checkbox', { name: /queueMicrotask/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Check answer' }))
    expect(screen.getByText('Incorrect')).toBeInTheDocument()
    expect(screen.getByText('Score 1/2')).toBeInTheDocument()
  })

  it('walks the decision tree forward and back', () => {
    render(<UIBlockRuntime raw={example('app-wont-start')} streaming={false} />)
    fireEvent.click(screen.getByRole('button', { name: /有报错/ }))
    expect(screen.getByText('报错里提到端口被占用吗？')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /^是/ }))
    expect(screen.getByText('Conclusion')).toBeInTheDocument()
    expect(screen.getByText('释放端口后重启')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(screen.getByText('报错里提到端口被占用吗？')).toBeInTheDocument()
  })

  it('switches the diff to split view', () => {
    const { container } = render(<UIBlockRuntime raw={example('retry-fix')} streaming={false} />)
    expect(container.querySelector('.uib-diff-body')).toHaveAttribute('data-view', 'unified')
    expect(container.querySelector('.uib-diff-stat')?.textContent).toBe('+4−2')
    fireEvent.click(screen.getByRole('radio', { name: 'Split' }))
    expect(container.querySelector('.uib-diff-body')).toHaveAttribute('data-view', 'split')
  })

  it('toggles chart series from the legend', () => {
    render(<UIBlockRuntime raw={example('orders-vs-conversion')} streaming={false} />)
    const legend = screen.getByRole('button', { name: '转化率' })
    fireEvent.click(legend)
    expect(legend).toHaveAttribute('aria-pressed', 'false')
  })

  it('collapses gantt groups and highlights a dependency chain', () => {
    const { container } = render(<UIBlockRuntime raw={example('v06-plan')} streaming={false} />)
    const labels = () => [...container.querySelectorAll('.uib-gantt-label-text')].map((node) => node.textContent)
    expect(labels()).toEqual(['设计', '交互设计', '技术方案', '开发', '前端实现', '后端接口', '联调测试', '发布'])
    fireEvent.click(screen.getByRole('button', { name: /^开发/ }))
    expect(labels()).toEqual(['设计', '交互设计', '技术方案', '开发', '联调测试', '发布'])
    act(() => {
      fireEvent.click(within(container.querySelector('.uib-gantt-body')!).getAllByRole('button', { name: '联调测试' })[1])
    })
    const states = [...container.querySelectorAll<HTMLElement>('.uib-gantt-row:not([data-group])')].map(
      (row) => `${row.querySelector('.uib-gantt-label-text')?.textContent}:${row.dataset.state ?? ''}`,
    )
    expect(states).toEqual(['交互设计:chain', '技术方案:chain', '联调测试:focus', '发布:chain'])
  })
})
