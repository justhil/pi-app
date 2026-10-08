import { describe, expect, it } from 'vitest'
import { fitBudget, foldRepeats, parseYaml, renderYaml, shapeSnapshot, shortUrl, slim } from './snapshot-shape'

const item = (i: number) => `  - listitem [ref=e${100 + i}]:\n    - link "Product number ${i} with a long enough title to matter" [ref=e${200 + i}] [cursor=pointer]:\n      - /url: /p/${i}?utm_source=x\n    - text: Price ${i}.00 and some description words`
const list = (n: number) => `- list [ref=e9]:\n${Array.from({ length: n }, (_, i) => item(i)).join('\n')}`

describe('parse / render', () => {
  it('round-trips nesting and block scalar continuation lines', () => {
    const yaml = '- main [ref=e1]:\n  - paragraph: |\n      line one\n      line two\n  - button "Go" [ref=e2]'
    expect(renderYaml(parseYaml(yaml))).toBe(yaml)
  })
})

describe('shortUrl', () => {
  it('keeps same-origin paths and drops tracking params', () => {
    expect(shortUrl('https://shop.test/a/b?id=3&utm_source=x&fbclid=y', 'https://shop.test')).toBe('/a/b?id=3')
  })
  it('keeps the host of other sites, shortens long queries and data urls', () => {
    expect(shortUrl(`https://cdn.test/x?${'q='.padEnd(60, 'z')}`, 'https://shop.test')).toBe('https://cdn.test/x?…')
    expect(shortUrl('data:image/png;base64,AAAA')).toBe('data:…')
  })
  it('caps very long urls', () => {
    expect(shortUrl(`https://a.test/${'p/'.repeat(80)}`).length).toBeLessThanOrEqual(101)
  })
})

describe('slim', () => {
  const run = (yaml: string) => renderYaml(slim(parseYaml(yaml), 'https://shop.test'))
  it('lifts single-child wrapper generics and drops the pointer hint on links', () => {
    expect(run('- generic [ref=e1]:\n  - generic [ref=e2]:\n    - link "Home" [ref=e3] [cursor=pointer]:\n      - /url: https://shop.test/')).toBe('- link "Home" [ref=e3]:\n  - /url: /')
  })
  it('keeps clickable generics and refs on regions, hides refs on plain text containers', () => {
    expect(run('- navigation [ref=e1]:\n  - generic [ref=e2] [cursor=pointer]: Menu\n  - paragraph [ref=e3]: hello')).toBe('- navigation [ref=e1]:\n  - generic [ref=e2] [cursor=pointer]: Menu\n  - paragraph: hello')
  })
  it('drops unnamed decorative images and caps long names', () => {
    const long = 'x'.repeat(150)
    expect(run(`- img [ref=e4]\n- button "${long}" [ref=e5]`)).toBe(`- button "${'x'.repeat(80)}…" [ref=e5]`)
  })
  it('leaves lines it does not understand alone', () => {
    expect(run("- 'weird: key' [ref=e1]")).toBe("- 'weird: key' [ref=e1]")
  })
})

describe('foldRepeats', () => {
  it('does not fold short runs', () => {
    const { folded } = foldRepeats(parseYaml(list(5)))
    expect(folded).toBe(0)
  })
  it('keeps three items and names the rest, pointing at the list ref', () => {
    const { nodes, folded } = foldRepeats(parseYaml(list(20)))
    const out = renderYaml(nodes)
    expect(folded).toBe(17)
    expect(out).toContain('Product number 2 ')
    expect(out).not.toContain('link "Product number 3 with')
    expect(out).toMatch(/- … 17 more listitems: "Product number 3 with[^"]*", .* · browser_snapshot target=e9 shows all/)
  })
  it('keeps focused items instead of the first ones', () => {
    const out = renderYaml(foldRepeats(parseYaml(list(20)), { focus: 'number 12 ' }).nodes)
    expect(out).toContain('Product number 12 with')
    expect(out).not.toContain('link "Product number 0 with')
  })
  it('folds repeating groups of siblings (title row, meta row, spacer)', () => {
    const rows = Array.from({ length: 12 }, (_, i) =>
      `  - row "story ${i}":\n    - cell "Story title number ${i} about something"\n  - row:\n    - cell: ${i} points by someone 3 hours ago | hide | 42 comments\n  - row`,
    ).join('\n')
    const { nodes, folded } = foldRepeats(parseYaml(`- table [ref=e3]:\n${rows}`))
    expect(folded).toBe(27)
    expect(renderYaml(nodes)).toMatch(/- … 9 more row groups: "story 3", "story 4"/)
  })
})

describe('fitBudget', () => {
  const big = (sections: number, lines: number) =>
    Array.from({ length: sections }, (_, s) => `- region "S${s}" [ref=e${s}]:\n${Array.from({ length: lines }, (_, l) => `  - paragraph: section ${s} text line ${l} ${'w'.repeat(40)}`).join('\n')}\n  - button "Act ${s}" [ref=e${1000 + s}]`).join('\n')

  it('returns untouched input under the budget', () => {
    const nodes = parseYaml(big(2, 3))
    expect(fitBudget(nodes, 100_000).truncated).toBe(false)
  })
  it('fits the budget, keeps every section and its buttons, drops text first', () => {
    const { nodes, truncated } = fitBudget(parseYaml(big(4, 200)), 8000)
    const out = renderYaml(nodes)
    expect(truncated).toBe(true)
    expect(out.length).toBeLessThanOrEqual(8000)
    for (let s = 0; s < 4; s++) {
      expect(out).toContain(`region "S${s}"`)
      expect(out).toContain(`button "Act ${s}"`)
    }
    expect(out).toMatch(/text lines? omitted here/)
  })
  it('cuts a single huge leaf section', () => {
    const { nodes } = fitBudget(parseYaml(big(1, 2000)), 5000)
    expect(renderYaml(nodes).length).toBeLessThanOrEqual(5000)
  })
})

describe('shapeSnapshot', () => {
  it('does not fold when asked for one region', () => {
    expect(shapeSnapshot(list(20), { fold: false }).folded).toBe(0)
    expect(shapeSnapshot(list(20)).folded).toBe(17)
  })
})
