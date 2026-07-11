import { Plus } from 'lucide-react'
import { cn } from '@renderer/lib/utils'
import { queueComposerLineRefAndFocus } from '@renderer/lib/composer-line-ref'

/**
 * Cursor-style gutter “+”: hover on a line, click to send path:line into the composer.
 */
export function LineGutterAddButton({
  path,
  line,
  endLine,
  content,
  className,
}: {
  path: string
  line: number
  endLine?: number
  content?: string
  className?: string
}) {
  if (!path || line < 1) return null

  return (
    <button
      type="button"
      className={cn(
        'line-gutter-add electron-no-drag',
        'flex h-[1.15em] w-[1.15em] shrink-0 items-center justify-center rounded',
        'opacity-0 transition-opacity duration-150',
        'text-foreground-secondary/70 hover:bg-primary/15 hover:text-primary',
        'group-hover/line:opacity-100 focus-visible:opacity-100',
        className,
      )}
      title={`引用 ${path}:${line} 到输入框`}
      aria-label={`引用第 ${line} 行到输入框`}
      onClick={(event) => {
        event.preventDefault()
        event.stopPropagation()
        queueComposerLineRefAndFocus({ path, line, endLine, content })
      }}
    >
      <Plus className="h-3 w-3" strokeWidth={2.5} />
    </button>
  )
}
