import type { AskQuestionPayload } from './questionnaire-dialog'

/** One question's in-progress answer. `useCustom` makes the free-text answer the choice. */
export type QuestionDraft = { selected: string[]; custom: string; useCustom: boolean }

/** The answer shape the worker maps back onto the extension's select / input calls. */
export type QuestionnaireAnswer =
  | { questionIndex: number; question: string; kind: 'custom'; answer: string }
  | { questionIndex: number; question: string; kind: 'multi'; answer: null; selected: string[] }
  | { questionIndex: number; question: string; kind: 'option'; answer: string | null }

const emptyDraft = (): QuestionDraft => ({ selected: [], custom: '', useCustom: false })

export function isAnswered(draft: QuestionDraft | undefined): boolean {
  if (!draft) return false
  return draft.useCustom ? draft.custom.trim().length > 0 : draft.selected.length > 0
}

export function unansweredIndexes(questions: AskQuestionPayload[], drafts: QuestionDraft[]): number[] {
  return questions.flatMap((_question, index) => (isAnswered(drafts[index]) ? [] : [index]))
}

export function buildAnswers(questions: AskQuestionPayload[], drafts: QuestionDraft[]): QuestionnaireAnswer[] {
  return questions.map((question, questionIndex) => {
    const draft = drafts[questionIndex] ?? emptyDraft()
    const custom = draft.custom.trim()
    if (draft.useCustom && custom) return { questionIndex, question: question.question, kind: 'custom', answer: custom }
    if (question.multiSelect) {
      // Keep the extension's option order, not the click order.
      const selected = question.options.map((option) => option.label).filter((label) => draft.selected.includes(label))
      return { questionIndex, question: question.question, kind: 'multi', answer: null, selected }
    }
    return { questionIndex, question: question.question, kind: 'option', answer: draft.selected[0] ?? null }
  })
}

export function chooseOption(draft: QuestionDraft, label: string, multi: boolean): QuestionDraft {
  if (!multi) return { ...draft, selected: [label], useCustom: false }
  const selected = draft.selected.includes(label) ? draft.selected.filter((value) => value !== label) : [...draft.selected, label]
  return { ...draft, selected, useCustom: false }
}

/** Drafts survive "answer later": the dialog unmounts while suspended and remounts on resume. */
const drafts = new Map<string, QuestionDraft[]>()
const MAX_DRAFTS = 20

export function loadDrafts(requestId: string, count: number): QuestionDraft[] {
  const saved = drafts.get(requestId) ?? []
  return Array.from({ length: count }, (_value, index) => saved[index] ?? emptyDraft())
}

export function saveDrafts(requestId: string, next: QuestionDraft[]): void {
  drafts.delete(requestId)
  drafts.set(requestId, next)
  if (drafts.size > MAX_DRAFTS) drafts.delete(drafts.keys().next().value!)
}

export function clearDrafts(requestId: string): void {
  drafts.delete(requestId)
}
