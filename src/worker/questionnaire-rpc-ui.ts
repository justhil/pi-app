import type { ExtensionUIContext } from '@earendil-works/pi-coding-agent'
import type {
  ExtensionUIQuestion,
  ExtensionUIQuestionAnswer,
  ExtensionUIQuestionnaireResult,
} from './desktop-ui-bridge.js'

type QuestionnaireRequester = (
  toolCallId: string,
  questions: ExtensionUIQuestion[],
  signal?: AbortSignal,
) => Promise<ExtensionUIQuestionnaireResult>

function matchingAnswer(
  result: ExtensionUIQuestionnaireResult,
  questionIndex: number,
): ExtensionUIQuestionAnswer | undefined {
  return result.answers.find((answer) => answer.questionIndex === questionIndex)
}

function rpcOptionValue(options: string[], label: string): string | undefined {
  return options.find((option) => {
    const withoutIndex = option.replace(/^\s*\d+\.\s*/, '')
    return withoutIndex === label || withoutIndex.startsWith(`${label} `)
  })
}

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

  const result = () => {
    resultPromise ??= request(toolCallId, questions, signal)
    return resultPromise
  }

  const select = async (_title: string, options: string[]): Promise<string | undefined> => {
    const current = questionIndex++
    const questionnaire = await result()
    if (questionnaire.cancelled) return undefined
    const answer = matchingAnswer(questionnaire, current)
    if (!answer) return undefined
    if (answer.kind === 'custom') {
      customInput = { questionIndex: current, answer: answer.answer || '' }
      return options.at(-1)
    }
    return answer.answer ? rpcOptionValue(options, answer.answer) : undefined
  }

  const input = async (): Promise<string | undefined> => {
    if (customInput) {
      const answer = customInput.answer
      customInput = null
      return answer
    }
    const current = questionIndex++
    const questionnaire = await result()
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
      if (property === 'input') return input
      return Reflect.get(target, property, receiver)
    },
  })
}
