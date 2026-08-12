import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import { ContextMessageBody } from './context-message-body'

describe('Context message body scrolling', () => {
  it('should_keep_mouse_wheel_inside_expanded_message_body', () => {
    const { getByTestId } = render(<ContextMessageBody>message body</ContextMessageBody>)
    const body = getByTestId('context-message-body')

    expect(body).toHaveAttribute('data-independent-scroll')
    expect(body).toHaveClass('overflow-auto', 'overscroll-contain')
    expect(body).not.toHaveAttribute('style')
  })
})
