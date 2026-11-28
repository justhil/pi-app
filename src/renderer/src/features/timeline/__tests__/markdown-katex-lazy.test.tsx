import { act, cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import MarkdownView from '../markdown-view'
import { mayContainMath } from '../markdown-katex-runtime'

afterEach(cleanup)

describe('KaTeX loads on demand', () => {
  it('detects every way a message can carry math', () => {
    expect(mayContainMath('plain **markdown** with `code`')).toBe(false)
    expect(mayContainMath('inline $x^2$')).toBe(true)
    expect(mayContainMath('LaTeX \\(x^2\\)')).toBe(true)
    expect(mayContainMath('\\[\nx^2\n\\]')).toBe(true)
    expect(mayContainMath('```latex\nx^2\n```')).toBe(true)
  })

  it('stays unloaded for text without math, then renders formulas once a message needs it', async () => {
    const plain = render(<MarkdownView>{'Just **text**, no formulas.'}</MarkdownView>)
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect(plain.container.querySelector('strong')).not.toBeNull()
    plain.unmount()

    const { container } = render(<MarkdownView>{'Euler: $e^{i\\pi} + 1 = 0$ and a fence:\n\n```math\na^2 + b^2 = c^2\n```'}</MarkdownView>)
    // The plain message above did not load KaTeX: the formula is still source text here.
    expect(container.querySelector('.katex')).toBeNull()
    expect(container.textContent).toContain('$e^{i\\pi} + 1 = 0$')

    await waitFor(() => expect(container.querySelectorAll('.katex').length).toBeGreaterThanOrEqual(2))
    expect(container.querySelector('.katex-display')).not.toBeNull()
    expect(container.textContent).not.toContain('$e^{i\\pi} + 1 = 0$')
  })
})
