import { useTranslation } from 'react-i18next'
import {
  Check,
  CheckCircle2,
  ChevronDown,
  Circle,
  CircleDot,
  List,
  XCircle,
  normalizeLegacyIconName,
  resolveAppIcon,
  type AppIconComponent,
} from '@renderer/components/icons'
import { cn } from '@renderer/lib/utils'
import { isTodoListWidgetProjection } from '@shared/adapter-widget'
import { todoCounts, type TodoStatus, type TodoWidgetItem } from '@shared/todo-list'
import { useUIStore } from '@renderer/stores/ui-store'
import { normalizeSessionFileKey } from '@renderer/lib/session-file-key'

const STATUS_ICONS: Record<TodoStatus, AppIconComponent> = {
  pending: Circle,
  in_progress: CircleDot,
  completed: CheckCircle2,
  cancelled: XCircle,
}

function widgetIcon(name?: string): AppIconComponent {
  const normalized = normalizeLegacyIconName(name)
  return normalized ? resolveAppIcon(normalized) : List
}

function TodoListProjection({ items }: { items: TodoWidgetItem[] }) {
  const { t } = useTranslation()
  return (
    <ul className="adapter-widget-list max-h-40 overflow-y-auto pb-0.5 pt-0.5" data-independent-scroll>
      {items.map((item) => {
        const Icon = STATUS_ICONS[item.status]
        return (
          <li
            key={item.id}
            className={cn(
              'adapter-widget-item flex items-start gap-1.5 py-1 text-[12px] leading-4',
              item.status === 'in_progress' && 'adapter-widget-item-current text-foreground',
              item.status === 'completed' && 'text-muted-foreground',
              item.status === 'cancelled' && 'text-muted-foreground/80',
            )}
          >
            <Icon
              className={cn(
                'mt-0.5 h-3.5 w-3.5 shrink-0',
                item.status === 'in_progress' && 'text-primary',
                item.status === 'completed' && 'text-[var(--success-semantic)]',
                item.status === 'cancelled' && 'text-muted-foreground/70',
                item.status === 'pending' && 'text-muted-foreground/55',
              )}
              strokeWidth={item.status === 'in_progress' ? 2 : 1.7}
            />
            <span
              className={cn(
                'min-w-0 flex-1 break-words',
                item.status === 'completed' && 'line-through decoration-muted-foreground/45',
              )}
            >
              {item.text}
            </span>
            {item.priority ? (
              <span className="shrink-0 rounded-sm bg-muted/65 px-1.5 py-0.5 text-2xs text-muted-foreground">
                {t(`composer:adapterWidget.priority.${item.priority}`)}
              </span>
            ) : null}
          </li>
        )
      })}
    </ul>
  )
}

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
  const Icon = widgetIcon(widget.icon)
  const summary = [
    t('composer:adapterWidget.progress', { completed: counts.completed, total: counts.total }),
    counts.inProgress > 0
      ? t('composer:adapterWidget.inProgressCount', { count: counts.inProgress })
      : counts.pending > 0
        ? t('composer:adapterWidget.pendingCount', { count: counts.pending })
        : t('composer:adapterWidget.complete'),
  ].join(' · ')

  return (
    <section className="adapter-widget-shell min-w-0" data-open={expanded ? 'true' : 'false'}>
      <button
        type="button"
        className="adapter-widget-trigger group flex h-7 max-w-full items-center gap-1.5 text-left text-foreground-secondary"
        aria-expanded={expanded}
        aria-label={`${widget.title}, ${summary}`}
        onClick={() => toggle(expansionKey)}
      >
        {counts.completed === counts.total ? (
          <Check className="h-3 w-3 shrink-0 text-[var(--success-semantic)]" strokeWidth={2} />
        ) : (
          <Icon className="h-3 w-3 shrink-0" strokeWidth={1.7} />
        )}
        <span className="truncate text-[12px]">{widget.title}</span>
        <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
          {counts.completed}/{counts.total}
        </span>
        <ChevronDown
          className="adapter-widget-chevron h-3 w-3 shrink-0 opacity-55"
          data-open={expanded ? 'true' : 'false'}
          strokeWidth={1.8}
        />
      </button>
      <div className="adapter-widget-expand" data-open={expanded ? 'true' : 'false'} aria-hidden={!expanded}>
        <div className="adapter-widget-expand-inner">
          {expanded ? <TodoListProjection items={items} /> : null}
        </div>
      </div>
    </section>
  )
}
