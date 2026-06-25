import { useEffect, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { useTranslation } from 'react-i18next'

export function ExtensionDialogShell({
  title,
  children,
  onDismiss,
  onSuspend,
  wide,
}: {
  title: string
  children: ReactNode
  /** 右上角 X、Esc、点遮罩：挂起（不取消 Worker 请求） */
  onDismiss: () => void
  onSuspend?: () => void
  wide?: boolean
}) {
  const { t } = useTranslation()
  const suspend = onSuspend ?? onDismiss

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') suspend()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [suspend])

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) suspend()
      }}
    >
      <div
        className={`relative w-full rounded-xl border border-border bg-background p-5 shadow-xl ${wide ? 'max-w-lg' : 'max-w-md'}`}
        role="dialog"
        aria-modal="true"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          className="absolute right-3 top-3 rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label={t('extension:answerLater')}
          onClick={suspend}
        >
          <X className="h-4 w-4" />
        </button>
        <h2 className="mb-3 pr-8 text-[15px] font-medium">{title}</h2>
        {children}
      </div>
    </div>
  )
}