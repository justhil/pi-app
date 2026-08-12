type QuestionnaireFooterProps = {
  tab: number
  isLast: boolean
  canAdvance: boolean
  onPrevious: () => void
  onNext: () => void
  onSubmit: () => void
  onSuspend: () => void
  onCancel: () => void
}

export function QuestionnaireFooter({
  tab,
  isLast,
  canAdvance,
  onPrevious,
  onNext,
  onSubmit,
  onSuspend,
  onCancel,
}: QuestionnaireFooterProps) {
  return (
    <div className="flex justify-between border-t px-5 py-3">
      <div className="flex gap-3">
        <button type="button" className="text-[13px] text-muted-foreground hover:text-foreground" onClick={onSuspend}>
          稍后作答
        </button>
        <button type="button" className="text-[13px] text-destructive/80 hover:text-destructive" onClick={onCancel}>
          取消并通知扩展
        </button>
      </div>
      <div className="flex gap-2">
        {tab > 0 && (
          <button type="button" className="rounded-md border px-3 py-1.5 text-[13px]" onClick={onPrevious}>
            上一题
          </button>
        )}
        {canAdvance && (
          <button
            type="button"
            className="rounded-md bg-primary px-3 py-1.5 text-[13px] text-primary-foreground"
            onClick={isLast ? onSubmit : onNext}
          >
            {isLast ? '提交' : '下一题'}
          </button>
        )}
      </div>
    </div>
  )
}
