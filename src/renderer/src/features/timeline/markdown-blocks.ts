import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'

/**
 * Incremental Markdown block splitting for streaming answers.
 *
 * Re-parsing a whole answer on every frame made streaming cost grow with answer length. Instead
 * the answer is cut into its top-level blocks and each block renders (and memoizes) on its own, so
 * a frame only re-parses the block that is still growing.
 *
 * Design borrowed from vastsa/pi-desktop's incremental block cache (their D152 decision); this is
 * an independent implementation. The cut points come from the same micromark/remark grammar the
 * renderer uses (react-markdown + remark-gfm + remark-math), never from a second hand-written
 * block grammar that could disagree with it. remark-breaks only affects inline content.
 */
const blockParser = unified().use(remarkParse).use(remarkGfm).use(remarkMath)

type MdNode = { type?: string; children?: MdNode[]; position?: { start?: { offset?: number } } }

/** Link / footnote definitions resolve across the whole document, so such a source can't be split. */
function containsDefinition(node: MdNode): boolean {
  if (node.type === 'definition' || node.type === 'footnoteDefinition') return true
  return Array.isArray(node.children) && node.children.some(containsDefinition)
}

export type MarkdownBlockSplit = {
  /** Source slices, concatenating back to the input. */
  blocks: string[]
  /** The source declares a definition; render it undivided. */
  documentScoped: boolean
}

export function splitMarkdownBlocks(source: string): MarkdownBlockSplit {
  if (!source) return { blocks: [], documentScoped: false }
  const tree = blockParser.parse(source) as MdNode
  const children = tree.children ?? []
  const documentScoped = containsDefinition(tree)
  const blocks: string[] = []
  let start = 0
  for (const child of children.slice(1)) {
    const offset = child.position?.start?.offset
    if (offset === undefined) return { blocks: [source], documentScoped }
    // Cut at the start of the block's first line: a block owns its leading indentation, and
    // dropping it would re-parse as a different block (nested list, indented code).
    const cut = source.lastIndexOf('\n', offset - 1) + 1
    if (cut <= start) continue
    blocks.push(source.slice(start, cut))
    start = cut
  }
  blocks.push(source.slice(start))
  return { blocks, documentScoped }
}

export type MarkdownBlockCache = {
  source: string
  blocks: string[]
  /** Latched once a definition is seen during an append run: keep rendering undivided. */
  undivided: boolean
}

export const EMPTY_MARKDOWN_BLOCK_CACHE: MarkdownBlockCache = { source: '', blocks: [], undivided: false }

/**
 * Split `source`, reusing the settled blocks of `cache` when `source` only appends to it.
 *
 * The last two cached blocks are re-parsed with the new text: an append can still change the last
 * block (a paragraph becoming a setext heading, a fence closing), and a last block that turns into
 * a list item or an indented continuation merges into the list right before it (`2. two` then `3`
 * growing into `3. three`). Blocks before those are closed off by an unchanged boundary.
 */
export function advanceMarkdownBlocks(cache: MarkdownBlockCache, source: string): MarkdownBlockCache {
  const appends = cache.blocks.length > 0 && source.startsWith(cache.source)
  if (appends && cache.undivided) return { source, blocks: [source], undivided: true }
  const reparsed = appends ? cache.blocks.slice(-2) : []
  const settled = appends ? cache.blocks.slice(0, cache.blocks.length - reparsed.length) : []
  const tailStart = cache.source.length - reparsed.reduce((sum, block) => sum + block.length, 0)
  const tail = splitMarkdownBlocks(source.slice(appends ? tailStart : 0))
  if (tail.documentScoped) return { source, blocks: [source], undivided: true }
  return { source, blocks: [...settled, ...tail.blocks], undivided: false }
}
