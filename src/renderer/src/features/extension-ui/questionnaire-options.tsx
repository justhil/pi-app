import type { AskQuestionPayload } from './questionnaire-dialog'

type QuestionnaireOptionsProps = {
  question: AskQuestionPayload
  singleValue?: string
  multiValue: string[]
  onSingleChange: (label: string) => void
  onMultiChange: (label: string, checked: boolean) => void
  onPreview: (label: string) => void
}

export function QuestionnaireOptions({
  question,
  singleValue,
  multiValue,
  onSingleChange,
  onMultiChange,
  onPreview,
}: QuestionnaireOptionsProps) {
  return (
    <div className="space-y-2">
      {question.options.map((option) => {
        const checked = question.multiSelect
          ? multiValue.includes(option.label)
          : singleValue === option.label
        return (
          <label
            key={option.label}
            className="flex w-full cursor-pointer items-start gap-3 rounded-md border px-3 py-2.5 text-left transition-colors has-[:checked]:border-primary/50 has-[:checked]:bg-accent hover:bg-accent/40"
            onMouseEnter={() => onPreview(option.label)}
            onFocus={() => onPreview(option.label)}
          >
            <input
              type={question.multiSelect ? 'checkbox' : 'radio'}
              name={question.multiSelect ? undefined : `question-${question.question}`}
              value={option.label}
              checked={checked}
              className="mt-0.5 h-4 w-4 shrink-0 accent-primary"
              onChange={(event) => {
                if (question.multiSelect) onMultiChange(option.label, event.target.checked)
                else onSingleChange(option.label)
              }}
            />
            <span className="min-w-0">
              <span className="block text-[13px] font-medium">{option.label}</span>
              {option.description && (
                <span className="block text-[12px] text-muted-foreground">
                  {option.description}
                </span>
              )}
            </span>
          </label>
        )
      })}
    </div>
  )
}
