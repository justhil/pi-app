import type { AskQuestionPayload } from './questionnaire-dialog'

/** One question's in-progress answer. `useCustom` makes the free-text answer the choice. */
export type QuestionDraft = { selected: string[]; custom: string; useCustom: boolean }

/** The answer shape the worker maps back onto the extension's select / input calls. */
export type QuestionnaireAnswer =
  | { questionIndex: number; question: string; kind: 'custom'; answer: string }
  | { questionIndex: number; question: string; kind: 'multi'; answer: null; selected: string[] }
  | { questionIndex: number; question: string; kind: 'option'; answer: string | null }

const RECOMMENDED_SUFFIX_RE =
  /\s*(?:\(recommended\)|\[recommended\]|（推荐）|【推荐】|★\s*recommended)\s*$/i

/**
 * Detects whether an option is recommended either via explicit `question.recommended`
 * (`pi-decide`) or via a `(Recommended)` / `（推荐）` label suffix (`rpiv-ask-user-question`),
 * returning the clean display text while preserving the original `option.label` for submission.
 */
export function parseOptionRecommendation(
  label: string,
  explicitRecommended?: string,
): { displayLabel: string; isRecommended: boolean } {
  const trimmed = label.trim()
  const byField = Boolean(explicitRecommended && explicitRecommended.trim() === trimmed)
  const hasSuffix = RECOMMENDED_SUFFIX_RE.test(trimmed)
  const clean = hasSuffix ? trimmed.replace(RECOMMENDED_SUFFIX_RE, '').trim() : label
  return {
    displayLabel: clean || label,
    isRecommended: byField || hasSuffix,
  }
}

export function emptyDraftForQuestion(question?: AskQuestionPayload): QuestionDraft {
  const freeTextOnly = Boolean(question && (!question.options || question.options.length === 0))
  return { selected: [], custom: '', useCustom: freeTextOnly }
}

export function isAnswered(draft: QuestionDraft | undefined): boolean {
  if (!draft) return false
  return draft.useCustom ? draft.custom.trim().length > 0 : draft.selected.length > 0
}

export function unansweredIndexes(questions: AskQuestionPayload[], drafts: QuestionDraft[]): number[] {
  return questions.flatMap((_question, index) => (isAnswered(drafts[index]) ? [] : [index]))
}

export function buildAnswers(questions: AskQuestionPayload[], drafts: QuestionDraft[]): QuestionnaireAnswer[] {
  return questions.map((question, questionIndex) => {
    const draft = drafts[questionIndex] ?? emptyDraftForQuestion(question)
    const custom = draft.custom.trim()
    if ((draft.useCustom || question.options.length === 0) && custom) {
      return { questionIndex, question: question.question, kind: 'custom', answer: custom }
    }
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

/** Drafts and active tab survive inline <-> modal toggling and "answer later" suspension. */
const drafts = new Map<string, QuestionDraft[]>()
const activeTabs = new Map<string, number>()
const MAX_DRAFTS = 20

export function loadDrafts(requestId: string, count: number, questions?: AskQuestionPayload[]): QuestionDraft[] {
  const saved = drafts.get(requestId) ?? []
  return Array.from({ length: count }, (_value, index) => saved[index] ?? emptyDraftForQuestion(questions?.[index]))
}

export function saveDrafts(requestId: string, next: QuestionDraft[]): void {
  drafts.delete(requestId)
  drafts.set(requestId, next)
  if (drafts.size > MAX_DRAFTS) drafts.delete(drafts.keys().next().value!)
}

export function loadActiveTab(requestId: string, count: number): number | undefined {
  const saved = activeTabs.get(requestId)
  if (typeof saved !== 'number' || saved < 0 || saved >= count) return undefined
  return saved
}

export function saveActiveTab(requestId: string, tab: number): void {
  activeTabs.delete(requestId)
  activeTabs.set(requestId, tab)
  if (activeTabs.size > MAX_DRAFTS) activeTabs.delete(activeTabs.keys().next().value!)
}

export function clearDrafts(requestId: string): void {
  drafts.delete(requestId)
  activeTabs.delete(requestId)
}
