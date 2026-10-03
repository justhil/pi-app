import { useTranslation } from 'react-i18next'
import {
  Check,
  CheckCircle2,
  ChevronDown,
  Circle,
  XCircle,
  type AppIconComponent,
} from '@renderer/components/icons'
import { cn } from '@renderer/lib/utils'
import { isTodoListWidgetProjection } from '@shared/adapter-widget'
import { todoCounts, type TodoStatus, type TodoWidgetItem } from '@shared/todo-list'
import { useUIStore } from '@renderer/stores/ui-store'
import { normalizeSessionFileKey } from '@renderer/lib/session-file-key'

/** Half-filled circle: the conventional "in progress" mark, legible at 12px in every icon theme. */
const InProgressIcon: AppIconComponent = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 16 16" className={className} aria-hidden>
    <circle cx="8" cy="8" r="6.25" fill="none" stroke="currentColor" strokeWidth="1.6" />
    <path d="M8 3.75a4.25 4.25 0 0 1 0 8.5z" fill="currentColor" />
  </svg>
)

const STATUS_ICONS: Record<TodoStatus, AppIconComponent> = {
  pending: Circle,
  in_progress: InProgressIcon,
  completed: CheckCircle2,
  cancelled: XCircle,
}

const PRIORITY_TONE: Record<string, string> = {
  high: 'text-amber-600 dark:text-amber-400',
  medium: 'text-foreground-secondary',
  low: 'text-muted-foreground/70',
}

function TodoListProjection({ items }: { items: TodoWidgetItem[] }) {
  const { t } = useTranslation()
  return (
    <ul className="adapter-widget-list max-h-[40vh] overflow-y-auto py-1" data-independent-scroll>
      {items.map((item) => {
        const Icon = STATUS_ICONS[item.status]
        const current = item.status === 'in_progress'
        return (
          <li
            key={item.id}
            className={cn(
              'adapter-widget-item flex items-start gap-2 rounded-md px-1.5 py-[3px] text-[12px] leading-[18px]',
              current && 'adapter-widget-item-current font-medium text-foreground',
              item.status === 'pending' && 'text-foreground-secondary',
              item.status === 'completed' && 'text-muted-foreground/75',
              item.status === 'cancelled' && 'text-muted-foreground/60 line-through decoration-muted-foreground/40',
            )}
          >
            <Icon
              className={cn(
                'mt-[3px] h-3 w-3 shrink-0',
                current && 'adapter-widget-pulse text-primary',
                item.status === 'completed' && 'text-[var(--success-semantic)]',
                item.status === 'cancelled' && 'text-muted-foreground/60',
                item.status === 'pending' && 'text-muted-foreground/55',
              )}
              strokeWidth={current ? 2.2 : 1.8}
            />
            <span className="min-w-0 flex-1 break-words">{item.text}</span>
            {item.priority ? (
              <span className={cn('mt-[1px] flex shrink-0 items-center gap-1 text-[10.5px]', PRIORITY_TONE[item.priority])}>
                <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />
                {t(`composer:adapterWidget.priority.${item.priority}`)}
              </span>
            ) : null}
          </li>
        )
      })}
    </ul>
  )
}

/** Small progress ring for the tray summary. */
function ProgressRing({ done, total }: { done: number; total: number }) {
  const r = 5
  const c = 2 * Math.PI * r
  const ratio = total > 0 ? done / total : 0
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" className="adapter-widget-ring shrink-0" aria-hidden>
      <circle cx="7" cy="7" r={r} className="track" />
      <circle cx="7" cy="7" r={r} className="value" strokeDasharray={c} strokeDashoffset={c * (1 - ratio)} transform="rotate(-90 7 7)" />
    </svg>
  )
}

/**
 * Todo tray attached to the top of the composer: the summary row names the item being worked on;
 * the list expands upwards in normal flow, so it never covers the timeline or the home title.
 */
export function ComposerAdapterWidgetHost() {
  const { t } = useTranslation()
  const widget = useUIStore((s) => s.composerWidget)
  const sessionFile = useUIStore((s) => s.historySessionFile)
  const expandedMap = useUIStore((s) => s.adapterWidgetExpandedBySession)
  const toggle = useUIStore((s) => s.toggleAdapterWidget)
  if (!widget || !isTodoListWidgetProjection(widget) || widget.payload.items.length === 0) return null

  const sessionKey = normalizeSessionFileKey(sessionFile) || sessionFile || 'session'
  const expansionKey = `${sessionKey}\u0000${widget.widgetKey}`
  const expanded = !!expandedMap[expansionKey]
  const items = widget.payload.items
  const counts = todoCounts(items)
  // Cancelled items are settled too: nothing left to do means the list is finished.
  const allDone = counts.inProgress === 0 && counts.pending === 0
  const current = items.find((i) => i.status === 'in_progress')
  const next = items.find((i) => i.status === 'pending')
  const focus = allDone
    ? t('composer:adapterWidget.complete')
    : current
      ? t('composer:adapterWidget.current', { text: current.text })
      : next
        ? t('composer:adapterWidget.next', { text: next.text })
        : ''
  return (
    <section className="adapter-widget-shell min-w-0" data-open={expanded ? 'true' : 'false'} data-done={allDone ? 'true' : 'false'}>
      <div className="adapter-widget-expand" data-open={expanded ? 'true' : 'false'} aria-hidden={!expanded}>
        <div className="adapter-widget-expand-inner">
          {expanded ? <TodoListProjection items={items} /> : null}
        </div>
      </div>
      <button
        type="button"
        className="adapter-widget-trigger group flex h-7 w-full min-w-0 items-center gap-1.5 text-left"
        aria-expanded={expanded}
        aria-label={`${widget.title}, ${counts.completed}/${counts.total}${focus ? `, ${focus}` : ''}`}
        onClick={() => toggle(expansionKey)}
      >
        {allDone ? (
          <Check className="h-3.5 w-3.5 shrink-0 text-[var(--success-semantic)]" strokeWidth={2.2} />
        ) : (
          <ProgressRing done={counts.completed} total={counts.total} />
        )}
        <span className="shrink-0 text-[12px] font-medium text-foreground-secondary">{widget.title}</span>
        <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
          {counts.completed}/{counts.total}
        </span>
        {focus ? (
          <span className={cn('min-w-0 flex-1 truncate text-[12px]', allDone ? 'text-muted-foreground' : 'text-foreground')}>
            <span className="mx-1 text-muted-foreground/40">·</span>
            {focus}
          </span>
        ) : (
          <span className="flex-1" />
        )}
        <ChevronDown
          className="adapter-widget-chevron h-3 w-3 shrink-0 opacity-55"
          data-open={expanded ? 'true' : 'false'}
          strokeWidth={1.8}
        />
      </button>
    </section>
  )
}
