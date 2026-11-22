import { fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { scrollTimelineByDelta } from '@renderer/features/timeline/timeline-scroll-bridge'
import { MainColumnWithTimelineScroll } from './main-column-with-timeline-scroll'

vi.mock('@renderer/features/timeline/timeline-scroll-bridge', () => ({
  scrollTimelineByDelta: vi.fn(() => true),
}))

const scrollTimelineByDeltaMock = vi.mocked(scrollTimelineByDelta)

afterEach(() => {
  scrollTimelineByDeltaMock.mockClear()
})

describe('MainColumnWithTimelineScroll', () => {
  it('should_leave_wheel_to_nested_region_when_target_is_independent_scroll', () => {
    const { getByTestId } = render(
      <MainColumnWithTimelineScroll>
        <div data-independent-scroll>
          <span data-testid="nested-target">thinking</span>
        </div>
      </MainColumnWithTimelineScroll>,
    )

    const event = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 80 })
    getByTestId('nested-target').dispatchEvent(event)

    expect(scrollTimelineByDeltaMock).not.toHaveBeenCalled()
    expect(event.defaultPrevented).toBe(false)
  })

  it('should_not_hijack_horizontal_trackpad_scroll_on_wide_code_or_tables', () => {
    const { getByTestId } = render(
      <MainColumnWithTimelineScroll>
        <pre data-testid="wide-code">horizontal code</pre>
      </MainColumnWithTimelineScroll>,
    )

    const event = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaX: 48, deltaY: 4 })
    getByTestId('wide-code').dispatchEvent(event)

    expect(scrollTimelineByDeltaMock).not.toHaveBeenCalled()
    expect(event.defaultPrevented).toBe(false)
  })

  it('should_forward_wheel_when_target_is_ordinary_main_column_content', () => {
    const { getByTestId } = render(
      <MainColumnWithTimelineScroll>
        <div data-testid="ordinary-target">blank column</div>
      </MainColumnWithTimelineScroll>,
    )

    const event = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 64 })
    getByTestId('ordinary-target').dispatchEvent(event)

    expect(scrollTimelineByDeltaMock).toHaveBeenCalledOnce()
    expect(scrollTimelineByDeltaMock).toHaveBeenCalledWith(64)
    expect(event.defaultPrevented).toBe(true)
  })

  it('should_keep_existing_textarea_wheel_exclusion', () => {
    const { getByRole } = render(
      <MainColumnWithTimelineScroll>
        <textarea aria-label="composer" />
      </MainColumnWithTimelineScroll>,
    )

    fireEvent.wheel(getByRole('textbox'), { deltaY: 48 })

    expect(scrollTimelineByDeltaMock).not.toHaveBeenCalled()
  })

  it('should_keep_existing_input_wheel_exclusion', () => {
    const { getByRole } = render(
      <MainColumnWithTimelineScroll>
        <input aria-label="model search" />
      </MainColumnWithTimelineScroll>,
    )

    fireEvent.wheel(getByRole('textbox'), { deltaY: 48 })

    expect(scrollTimelineByDeltaMock).not.toHaveBeenCalled()
  })

  it('should_leave_wheel_to_descendant_of_composer_root', () => {
    const { getByTestId } = render(
      <MainColumnWithTimelineScroll>
        <div data-composer-root>
          <span data-testid="composer-descendant">composer control</span>
        </div>
      </MainColumnWithTimelineScroll>,
    )

    fireEvent.wheel(getByTestId('composer-descendant'), { deltaY: 48 })

    expect(scrollTimelineByDeltaMock).not.toHaveBeenCalled()
  })

  it('should_keep_existing_popover_wheel_exclusion', () => {
    const { getByTestId } = render(
      <MainColumnWithTimelineScroll>
        <div data-slash-popover>
          <span data-testid="popover-target">command</span>
        </div>
      </MainColumnWithTimelineScroll>,
    )

    fireEvent.wheel(getByTestId('popover-target'), { deltaY: 48 })

    expect(scrollTimelineByDeltaMock).not.toHaveBeenCalled()
  })
})
