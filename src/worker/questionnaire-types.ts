export type ExtensionUIQuestion = {
  question: string
  header?: string
  multiSelect?: boolean
  options: Array<{
    label: string
    description?: string
    hasPreview?: boolean
    preview?: string
  }>
}

export type ExtensionUIQuestionAnswer = {
  questionIndex: number
  question: string
  kind: 'option' | 'multi' | 'custom'
  answer: string | null
  selected?: string[]
}

export type ExtensionUIQuestionnaireResult = {
  cancelled: boolean
  answers: ExtensionUIQuestionAnswer[]
}
