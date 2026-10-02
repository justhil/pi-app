import type { Ref } from 'react'
import { useTranslation } from 'react-i18next'

type QuestionnaireFooterProps = {
  tab: number
  isLast: boolean
  notice: string | null
  primaryRef?: Ref<HTMLButtonElement>
  onPrevious: () => void
  onNext: () => void
  onSubmit: () => void
  onSuspend: () => void
  onCancel: () => void
}

export function QuestionnaireFooter({
  tab,
  isLast,
  notice,
  primaryRef,
  onPrevious,
  onNext,
  onSubmit,
  onSuspend,
  onCancel,
}: QuestionnaireFooterProps) {
  const { t } = useTranslation()
  return (
    <div className="border-t px-5 py-3">
      {notice && (
        <p className="questionnaire-reveal mb-2 text-right text-[12px] text-amber-600 dark:text-amber-400" role="status">
          {notice}
        </p>
      )}
      <div className="flex items-center justify-between gap-3 whitespace-nowrap">
        <div className="flex gap-3">
          <button type="button" className="text-[12.5px] text-muted-foreground hover:text-foreground" onClick={onSuspend}>
            {t('extension:answerLater')}
          </button>
          <button type="button" className="text-[12.5px] text-destructive/75 hover:text-destructive" onClick={onCancel}>
            {t('extension:cancelNotifyExt')}
          </button>
        </div>
        <div className="flex items-center gap-2">
          {tab > 0 && (
            <button type="button" className="rounded-md border px-3 py-1.5 text-[13px] hover:bg-muted" onClick={onPrevious}>
              {t('extension:qPrevious')}
            </button>
          )}
          <button
            ref={primaryRef}
            type="button"
            className="rounded-md bg-primary px-3.5 py-1.5 text-[13px] text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-1"
            onClick={isLast ? onSubmit : onNext}
          >
            {isLast ? t('extension:qSubmit') : t('extension:qNext')}
          </button>
        </div>
      </div>
    </div>
  )
}
