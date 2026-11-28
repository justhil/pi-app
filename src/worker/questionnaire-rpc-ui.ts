import type { ExtensionUIContext } from '@earendil-works/pi-coding-agent'
import type {
  ExtensionUIQuestion,
  ExtensionUIQuestionAnswer,
  ExtensionUIQuestionnaireResult,
} from './desktop-ui-bridge.js'

export type QuestionnaireRequester = (
  toolCallId: string,
  questions: ExtensionUIQuestion[],
  signal?: AbortSignal,
  timeoutMs?: number,
) => Promise<ExtensionUIQuestionnaireResult>

const TOGGLE_DONE_RE = /^(?:✅\s*)?done$/i
const TOGGLE_MARK_RE = /^(?:◻|✅|☐|☑)\s*/
const NUMBER_PREFIX_RE = /^\s*\d+[.)]\s*/
const RECOMMENDED_SUFFIX_RE = /\s*★\s*recommended$/i

function matchingAnswer(
  result: ExtensionUIQuestionnaireResult,
  questionIndex: number,
): ExtensionUIQuestionAnswer | undefined {
  return result.answers.find((answer) => answer.questionIndex === questionIndex)
}

function cleanRenderedOption(option: string): string {
  return option
    .replace(TOGGLE_MARK_RE, '')
    .replace(NUMBER_PREFIX_RE, '')
    .replace(RECOMMENDED_SUFFIX_RE, '')
    .trim()
}

function rpcOptionValue(options: string[], label: string): string | undefined {
  const cleanTarget = label.trim()
  return options.find((option) => {
    const cleaned = cleanRenderedOption(option)
    if (cleaned === cleanTarget) return true
    const withoutIndex = option.replace(NUMBER_PREFIX_RE, '').trim()
    return (
      withoutIndex === cleanTarget ||
      withoutIndex.startsWith(`${cleanTarget} —`) ||
      withoutIndex.startsWith(`${cleanTarget} -`) ||
      withoutIndex.startsWith(`${cleanTarget} ★`) ||
      withoutIndex.startsWith(`${cleanTarget} `)
    )
  })
}

function findToggleDoneRow(options: string[]): string | undefined {
  return options.find((opt) => TOGGLE_DONE_RE.test(opt.trim()))
}

/**
 * Translates RPC-mode sequential `ui.select` / `ui.input` / `ui.editor` prompt loops
 * (used by rpiv-ask-user-question & forks, pi-decide, pi-ask-user-questions, and
 * @narumitw/pi-tui-kit) into a single rich multi-question desktop QuestionnaireDialog
 * / ComposerInlineQuestionnaire request, preserving deadline timeouts, multi-select
 * toggle loops, recommended badges, and custom free-form answers.
 */
export function createQuestionnaireRpcUI(
  base: ExtensionUIContext,
  toolCallId: string,
  questions: ExtensionUIQuestion[],
  signal: AbortSignal | undefined,
  request: QuestionnaireRequester,
): ExtensionUIContext {
  let resultPromise: Promise<ExtensionUIQuestionnaireResult> | null = null
  let questionIndex = 0
  let customInput: { questionIndex: number; answer: string } | null = null
  let activeToggle: { questionIndex: number; queue: string[]; doneRow: string } | null = null

  const result = (timeoutMs?: number) => {
    resultPromise ??= request(toolCallId, questions, signal, timeoutMs)
    return resultPromise
  }

  const select = async (
    _title: string,
    options: string[],
    opts?: { timeout?: number; signal?: AbortSignal },
  ): Promise<string | undefined> => {
    const questionnaire = await result(opts?.timeout)
    if (questionnaire.cancelled) return undefined

    // Continue an in-progress multi-select toggle loop (e.g. pi-decide `◻ Option` ... `✅ Done`)
    const doneRow = findToggleDoneRow(options)
    if (activeToggle && doneRow) {
      const nextLabel = activeToggle.queue.shift()
      if (nextLabel === undefined) {
        activeToggle = null
        return doneRow
      }
      return rpcOptionValue(options, nextLabel) ?? nextLabel
    }
    activeToggle = null

    const current = questionIndex++
    const answer = matchingAnswer(questionnaire, current)
    if (!answer) return undefined

    // Start a multi-select toggle loop when the caller presents a `✅ Done` sentinel row
    if (doneRow) {
      if (answer.kind === 'custom') {
        const customText = (answer.answer || '').trim()
        return customText || undefined
      }
      const picked =
        answer.kind === 'multi'
          ? [...(answer.selected || [])]
          : answer.answer
            ? [answer.answer]
            : []
      if (picked.length === 0) return doneRow
      const [first, ...rest] = picked
      activeToggle = { questionIndex: current, queue: rest, doneRow }
      return rpcOptionValue(options, first) ?? first
    }

    if (answer.kind === 'custom') {
      const customText = answer.answer || ''
      // Extensions that append a trailing sentinel row ("3. Type something." / "Other (free-form)")
      // expect that sentinel row first, then read the typed text via `ui.input()` or `ui.editor()`.
      const authoredCount = questions[current]?.options.length ?? 0
      const hasSyntheticOtherRow = authoredCount > 0 && options.length === authoredCount + 1
      if (hasSyntheticOtherRow) {
        customInput = { questionIndex: current, answer: customText }
        return options.at(-1)
      }
      // Native prompters without a synthetic "Other" row (like pi-decide) treat unmatched return strings as free text.
      return customText
    }

    return answer.answer ? rpcOptionValue(options, answer.answer) : undefined
  }

  const consumeCustomText = async (
    _title?: string,
    _placeholder?: string,
    opts?: { timeout?: number; signal?: AbortSignal },
  ): Promise<string | undefined> => {
    if (customInput) {
      const answer = customInput.answer
      customInput = null
      return answer
    }
    const current = questionIndex++
    const questionnaire = await result(opts?.timeout)
    if (questionnaire.cancelled) return undefined
    const answer = matchingAnswer(questionnaire, current)
    if (!answer) return undefined
    if (answer.kind === 'multi') {
      const selected = new Set(answer.selected || [])
      return questions[current]?.options
        .flatMap((option, index) => (selected.has(option.label) ? [String(index + 1)] : []))
        .join(',')
    }
    return answer.answer || ''
  }

  return new Proxy(base, {
    get(target, property, receiver) {
      if (property === 'select') return select
      if (property === 'input' || property === 'editor') return consumeCustomText
      return Reflect.get(target, property, receiver)
    },
  })
}
