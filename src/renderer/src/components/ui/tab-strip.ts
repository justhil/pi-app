import { useCallback } from 'react'
import type { WheelEvent } from 'react'

/**
 * A tab strip is one line by design, so a vertical wheel has to move it sideways; a plain
 * `overflow-x-auto` strip ignores the wheel and looks frozen once the tabs outgrow the pane.
 */
export function useStripWheel() {
  return useCallback((e: WheelEvent<HTMLElement>) => {
    const el = e.currentTarget
    if (el.scrollWidth <= el.clientWidth) return
    const delta = e.deltaX || e.deltaY
    if (!delta) return
    el.scrollLeft += delta
  }, [])
}

/**
 * Shared tab-strip metrics: the editor strip, the right-panel tabs and the terminal tabs all sit on
 * the same top row of their column, so their heights must stay identical instead of being re-typed
 * per strip (they drifted apart before).
 */
export const TAB_STRIP_CLASS = 'flex h-11 shrink-0 items-center gap-1 border-b border-border/40 px-2'
export const TAB_ITEM_CLASS =
  'flex h-8 shrink-0 items-center rounded-md px-2.5 text-[12px] font-medium whitespace-nowrap transition-colors'
export const TAB_ITEM_ACTIVE_CLASS = 'bg-[var(--bg-active)] text-foreground'
export const TAB_ITEM_IDLE_CLASS =
  'text-foreground-secondary hover:bg-[var(--bg-hover)] hover:text-foreground'
