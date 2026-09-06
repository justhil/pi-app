import { describe, expect, it } from 'vitest'
import {
  clearReviewComments,
  formatReviewCommentsForPrompt,
  upsertReviewComment,
} from './review-inline-comments'

describe('review comment packing', () => {
  it('formats path and hunk into one prompt block', () => {
    const cwd = '/tmp/review-pack'
    clearReviewComments(cwd)
    upsertReviewComment(cwd, { filePath: 'src/a.ts', hunkIndex: 0, lineIndex: 0, text: 'rename this' })
    upsertReviewComment(cwd, { filePath: 'src/b.ts', hunkIndex: 1, lineIndex: 0, text: 'drop dead code' })
    const packed = formatReviewCommentsForPrompt(cwd)
    expect(packed).toContain('src/a.ts:1 hunk 1: rename this')
    expect(packed).toContain('src/b.ts:1 hunk 2: drop dead code')
    clearReviewComments(cwd)
  })
})
