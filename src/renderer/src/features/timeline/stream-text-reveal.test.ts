import { createElement } from 'react'
import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { STREAM_REVEAL_MAX_LAG_CHARS, STREAM_REVEAL_TIP_CHARS, StreamLiveTail } from './stream-text-reveal'

describe('stream reveal tip budget', () => {
  it('uses at most two newest characters for soft fade tip', () => {
    expect(STREAM_REVEAL_TIP_CHARS).toBe(2)
    expect(STREAM_REVEAL_MAX_LAG_CHARS).toBe(2)
  })

  it('should_not_split_surrogate_pair_emoji_or_remount_tip_span_on_append', () => {
    // Emoji is 2 UTF-16 code units; slicing by .length - 2 after "A😀B" splits the surrogate pair in half!
    const { container, rerender } = render(
      createElement(StreamLiveTail, { text: 'Hi😀!', streaming: true }),
    )
    const tipBefore = container.querySelector('.stream-char-tip')
    expect(tipBefore).not.toBeNull()
    // Ensure neither body nor tip contains an unpaired UTF-16 surrogate.
    const loneSurrogate = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/
    for (const child of Array.from(container.firstElementChild?.childNodes ?? [])) {
      expect(loneSurrogate.test(child.textContent ?? '')).toBe(false)
    }

    rerender(createElement(StreamLiveTail, { text: 'Hi😀!!', streaming: true }))
    const tipAfter = container.querySelector('.stream-char-tip')
    expect(tipAfter).toBe(tipBefore)
  })
})
