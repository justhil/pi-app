import { describe, expect, it, vi } from 'vitest'

vi.mock('mermaid', () => ({ default: { initialize: vi.fn(), parse: vi.fn(), render: vi.fn() } }))
const { naturalSize, sanitizeMermaidSvg, summarizeMermaidError } = await import('../mermaid-render')

describe('sanitizeMermaidSvg', () => {
  it('keeps Mermaid styles and HTML labels but drops scripts, handlers and links', () => {
    const svg = [
      '<svg id="m" viewBox="0 0 10 10"><style>#m .node rect{fill:#eee}</style>',
      '<g class="node" onclick="alert(1)"><rect width="5" height="5"></rect>',
      '<foreignObject width="5" height="5"><div xmlns="http://www.w3.org/1999/xhtml"><span class="nodeLabel">A</span></div></foreignObject></g>',
      '<script>alert(2)</script><a href="javascript:alert(3)"><text>x</text></a></svg>',
    ].join('')
    const out = sanitizeMermaidSvg(svg)
    expect(out).toContain('<style>')
    expect(out).toContain('nodeLabel')
    expect(out.toLowerCase()).toContain('foreignobject')
    expect(out).not.toMatch(/onclick|<script|javascript:/i)
  })
})

describe('naturalSize', () => {
  it('replaces the stretching 100% width with the viewBox size', () => {
    const out = naturalSize('<svg id="m" width="100%" style="max-width: 420px;" viewBox="-8 -8 420.5 260"><g></g></svg>')
    expect(out).toMatch(/^<svg width="421" height="260" id="m" style="min-width: 316px; max-width: 420px;" viewBox="-8 -8 420.5 260">/)
  })

  it('leaves an SVG without a viewBox alone', () => {
    expect(naturalSize('<svg width="10"></svg>')).toBe('<svg width="10"></svg>')
  })
})

describe('summarizeMermaidError', () => {
  it('keeps the position and the expectation, dropping the excerpt and caret', () => {
    const error = new Error("Parse error on line 3:\n...h TD  A -->\n--------------^\nExpecting 'AMP', 'ALPHA', got 'EOF'")
    expect(summarizeMermaidError(error)).toBe("Parse error on line 3: Expecting 'AMP', 'ALPHA', got 'EOF'")
  })
})
