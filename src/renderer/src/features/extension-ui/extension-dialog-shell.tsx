import { useEffect, useId, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { X } from '@renderer/components/icons'
import { cn } from '@renderer/lib/utils'

/**
 * 扩展交互弹窗通用壳层：支持“可挂起（稍后作答）”与“直接取消（如回退确认）”两种语义，
 * 避免无时间线工具行的导航确认弹窗被误挂起而导致 Worker 120s 阻塞。
 */
export function ExtensionDialogShell({
  title,
  subtitle,
  maxWidthClass = 'max-w-lg',
  onSuspend,
  suspendable = true,
  children,
}: {
  title: ReactNode
  subtitle?: ReactNode
  maxWidthClass?: string
  onSuspend: () => void
  suspendable?: boolean
  children: ReactNode
}) {
  const { t } = useTranslation()
  const titleId = useId()
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        onSuspend()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onSuspend])

  const closeLabel = suspendable ? t('extension:answerLater') : t('extension:cancel')

  return (
    <div
      className="overlay-backdrop fixed inset-0 z-[130] flex items-center justify-center bg-black/40 p-4 backdrop-blur-[2px]"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onSuspend()
      }}
    >
      <div
        className={cn(
          'overlay-panel flex max-h-[85vh] w-full flex-col overflow-hidden rounded-xl border border-border/85 bg-background shadow-2xl',
          maxWidthClass,
        )}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-start justify-between gap-2 border-b border-border/60 px-4 py-3">
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="text-[14px] font-semibold leading-snug text-foreground">{title}</h2>
            {subtitle && (
              <div className="mt-0.5 text-[12px] leading-snug text-muted-foreground">{subtitle}</div>
            )}
          </div>
          <button
            type="button"
            title={closeLabel}
            aria-label={closeLabel}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-[var(--bg-hover)] hover:text-foreground"
            onClick={onSuspend}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="studio-thin-scroll flex min-h-0 flex-1 flex-col overflow-y-auto px-4 py-3.5">
          {children}
        </div>
      </div>
    </div>
  )
}
