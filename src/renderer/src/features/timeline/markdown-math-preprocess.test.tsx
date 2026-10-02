import { describe, expect, it } from 'vitest'
import { escapeNonMathDollars, preprocessMarkdownMath } from './markdown-math-preprocess'

describe('escapeNonMathDollars', () => {
  it('escapes currency that would otherwise pair up into a formula', () => {
    expect(escapeNonMathDollars('最贵档 $13.43/task，比 Sonnet Max 还便宜 $3.97/task')).toBe(
      '最贵档 \\$13.43/task，比 Sonnet Max 还便宜 \\$3.97/task',
    )
    expect(escapeNonMathDollars('| Opus | 57.8% | $13.43 |')).toBe('| Opus | 57.8% | \\$13.43 |')
    expect(escapeNonMathDollars('costs $5 and $10')).toBe('costs \\$5 and \\$10')
  })

  it('keeps real inline math, including CJK inside \\text{}', () => {
    expect(escapeNonMathDollars('面积 $S = \\pi r^2$ 成立')).toBe('面积 $S = \\pi r^2$ 成立')
    expect(escapeNonMathDollars('$x_1$ and $y$')).toBe('$x_1$ and $y$')
    expect(escapeNonMathDollars('$v = \\text{速度}$')).toBe('$v = \\text{速度}$')
  })

  it('escapes pairs whose body is bare CJK prose', () => {
    expect(escapeNonMathDollars('$是合理的$')).toBe('\\$是合理的\\$')
  })

  it('leaves code, display math and already-escaped dollars alone', () => {
    const src = ['```bash', 'echo $HOME $PATH', '```', 'run `echo $1` now', '$$', 'a = $b', '$$', 'price \\$5'].join('\n')
    expect(escapeNonMathDollars(src)).toBe(src)
    expect(escapeNonMathDollars('$$E = mc^2$$')).toBe('$$E = mc^2$$')
  })

  it('is applied by preprocessMarkdownMath', () => {
    expect(preprocessMarkdownMath('only $20 today')).toBe('only \\$20 today')
  })
})

describe('rendered through remark-math + KaTeX', () => {
  it('shows currency as text and still renders real math', async () => {
    const { render } = await import('@testing-library/react')
    const { default: ReactMarkdown } = await import('react-markdown')
    const { default: remarkMath } = await import('remark-math')
    const { default: rehypeKatex } = await import('rehype-katex')
    const md = preprocessMarkdownMath('Opus 是天花板，但最贵档 $13.43/task，比 Sonnet 还便宜 $3.97/task。公式 $a^2$。')
    const { container } = render(
      <ReactMarkdown remarkPlugins={[[remarkMath, { singleDollarTextMath: true }]]} rehypePlugins={[[rehypeKatex, { strict: 'ignore' }]]}>
        {md}
      </ReactMarkdown>,
    )
    expect(container.querySelectorAll('.katex')).toHaveLength(1)
    expect(container.textContent).toContain('$13.43/task，比 Sonnet 还便宜 $3.97/task')
  })
})

describe('LaTeX \\[ \\] and \\( \\) delimiters', () => {
  async function renderMd(source: string, streaming = false) {
    const { render } = await import('@testing-library/react')
    const { default: ReactMarkdown } = await import('react-markdown')
    const { default: remarkMath } = await import('remark-math')
    const { default: rehypeKatex } = await import('rehype-katex')
    return render(
      <ReactMarkdown remarkPlugins={[[remarkMath, { singleDollarTextMath: true }]]} rehypePlugins={[[rehypeKatex, { strict: 'ignore' }]]}>
        {preprocessMarkdownMath(source, { streaming })}
      </ReactMarkdown>,
    ).container
  }

  /** Text outside rendered formulas (KaTeX keeps the TeX source in a hidden MathML annotation). */
  function prose(container: HTMLElement): string {
    const copy = container.cloneNode(true) as HTMLElement
    copy.querySelectorAll('.katex').forEach((el) => el.remove())
    return copy.textContent ?? ''
  }

  it('renders a multi-line \\[ \\] block as display math', async () => {
    const container = await renderMd('按他说的比例：\n\n\\[\nP_{\\text{Sonnet}}=0.5T\\times2=1T\n\\]\n\n下一段')
    expect(container.querySelectorAll('.katex-display')).toHaveLength(1)
    expect(prose(container)).not.toMatch(/[[\]\\]|times/)
    expect(container.textContent).toContain('下一段')
  })

  it('renders a one-line \\[ \\] block, keeping list indentation', async () => {
    expect(preprocessMarkdownMath('  \\[ x^2 \\]')).toBe('  $$\n  x^2\n  $$')
    const container = await renderMd('- 面积：\n\n  \\[ S = \\pi r^2 \\]')
    expect(container.querySelectorAll('li .katex-display')).toHaveLength(1)
  })

  it('renders \\( \\) as inline math', async () => {
    expect(preprocessMarkdownMath('速度 \\( v = \\text{距离} / t \\) 成立')).toBe('速度 $v = \\text{距离} / t$ 成立')
    const container = await renderMd('其中 \\(a^2 + b^2\\) 与 \\( c^2 \\) 相等')
    expect(container.querySelectorAll('.katex')).toHaveLength(2)
    expect(container.querySelectorAll('.katex-display')).toHaveLength(0)
  })

  it('leaves code, $$ blocks and escaped brackets in prose alone', () => {
    const src = ['```tex', '\\[x\\]', '```', 'run `\\(x\\)` now', '$$', 'a \\\\(b)', '$$', '参考 \\[1\\] 的说法', '\\[2\\] 某篇文献'].join('\n')
    expect(preprocessMarkdownMath(src)).toBe(src.replace('```tex', '```math'))
  })

  it('closes an unfinished \\[ block while streaming', async () => {
    const container = await renderMd('结果：\n\n\\[\nP = 0.5T \\times 10', true)
    expect(container.querySelectorAll('.katex-display')).toHaveLength(1)
    expect(prose(container)).not.toMatch(/[[\]\\]|times/)
  })
})
