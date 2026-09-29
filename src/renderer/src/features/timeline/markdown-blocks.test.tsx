import { renderToStaticMarkup } from 'react-dom/server'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkBreaks from 'remark-breaks'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import { describe, expect, it } from 'vitest'
import {
  advanceMarkdownBlocks,
  EMPTY_MARKDOWN_BLOCK_CACHE,
  splitMarkdownBlocks,
} from './markdown-blocks'

const remarkPlugins = [remarkGfm, remarkBreaks, [remarkMath, { singleDollarTextMath: true }]] as never
const rehypePlugins = [[rehypeKatex, { throwOnError: false }]] as never

function html(markdown: string): string {
  return renderToStaticMarkup(
    <ReactMarkdown remarkPlugins={remarkPlugins} rehypePlugins={rehypePlugins}>
      {markdown}
    </ReactMarkdown>,
  ).replace(/>\s+</g, '><')
}

const CORPUS: Record<string, string> = {
  paragraphs: 'First paragraph with `code`.\n\nSecond paragraph\nwith a soft break.\n\n\nThird after two blank lines.',
  looseList: '- first item\n\n- second item\n\n- third item\n\nAfter the list.',
  orderedLoose: '1. one\n\n2. two\n\n3. three',
  nestedList: '- parent\n\n  continuation paragraph\n\n  - child\n\n- sibling',
  fenceWithBlankLines: 'Intro\n\n```ts\nconst a = 1\n\nconst b = 2\n```\n\nOutro',
  tildeFence: '~~~\nplain\n\n~~~\n\nafter',
  displayMath: 'Equation:\n\n$$\na = b\n\n+ c\n$$\n\nDone.',
  table: '| a | b |\n| --- | --- |\n| 1 | 2 |\n\nText under the table.',
  headings: '# Title\n\nBody\n\n## Section\n\n- a\n- b\n\n### Deeper\n\nEnd',
  indentedCode: 'Para\n\n    indented code\n\n    more code\n\nBack to text',
  blockquote: '> quoted\n>\n> still quoted\n\nnot quoted',
  indentedItems: '  - two-space item\n  - another\n\ntext',
  mathWithListInside: '$$\n- 1\n\n> 2\n$$\n\nafter',
}

describe('splitMarkdownBlocks', () => {
  for (const [name, markdown] of Object.entries(CORPUS)) {
    it(`renders ${name} identically as blocks and as one document`, () => {
      const { blocks } = splitMarkdownBlocks(markdown)
      expect(blocks.length).toBeGreaterThan(0)
      expect(blocks.join('')).toBe(markdown)
      expect(blocks.map(html).join('')).toBe(html(markdown))
    })
  }

  it('never cuts inside a fenced code block or $$ math', () => {
    const { blocks } = splitMarkdownBlocks(`${CORPUS.fenceWithBlankLines}\n\n${CORPUS.displayMath}`)
    expect(blocks.some((block) => block.includes('const a = 1\n\nconst b = 2'))).toBe(true)
    expect(blocks.some((block) => block.includes('a = b\n\n+ c'))).toBe(true)
  })

  it('keeps a source with a link or footnote definition undivided', () => {
    const source = 'See [the spec][spec] and a note[^1].\n\nMore text.\n\n[spec]: https://example.test\n\n[^1]: Footnote.'
    const cache = advanceMarkdownBlocks(EMPTY_MARKDOWN_BLOCK_CACHE, source)
    expect(cache.blocks).toEqual([source])
    expect(advanceMarkdownBlocks(cache, `${source}\n\nTail.`).blocks).toHaveLength(1)
  })
})

describe('advanceMarkdownBlocks', () => {
  it('matches a fresh split at every streaming step and reuses settled blocks', () => {
    const full = Object.values(CORPUS).join('\n\n')
    let cache = EMPTY_MARKDOWN_BLOCK_CACHE
    for (let end = 1; end <= full.length; end += 1) {
      const source = full.slice(0, Math.min(end, full.length))
      const previous = cache
      cache = advanceMarkdownBlocks(previous, source)
      expect(cache.blocks).toEqual(splitMarkdownBlocks(source).blocks)
      // Settled blocks keep their exact text, so memoized block renders are reused.
      for (let index = 0; index < previous.blocks.length - 2; index++) {
        expect(cache.blocks[index]).toBe(previous.blocks[index])
      }
    }
  })

  it('re-splits from scratch when the source is edited rather than appended', () => {
    const cache = advanceMarkdownBlocks(EMPTY_MARKDOWN_BLOCK_CACHE, 'one\n\ntwo\n\nthree')
    expect(advanceMarkdownBlocks(cache, 'uno\n\ntwo').blocks).toEqual(['uno\n\n', 'two'])
  })
})
