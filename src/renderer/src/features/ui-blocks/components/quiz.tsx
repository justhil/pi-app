import { memo, useCallback, useMemo, useRef, useState, type CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, ChevronLeft, ChevronRight, RotateCcw, X } from '@renderer/components/icons'
import { useBlockState } from '../block-state'
import { BlockFrame } from '../frame'
import { v } from '../schema'
import type { UIBlockComponentProps, UIBlockDefinition } from '../types'
import { ImageLightbox, safeBlockImageUrl } from './image-gallery'

type RawAnswer = number | string
type RichOption = { text: string; next?: string; explanation?: string }
type RawOption = string | RichOption
type QuizQuestion = {
  id?: string
  question: string
  image?: string
  options: RawOption[]
  answer?: RawAnswer | RawAnswer[]
  explanation?: string
  next?: string
}
type QuizProps = { title?: string; mode?: 'list' | 'step'; questions: QuizQuestion[] }

const rawAnswer = v.custom<RawAnswer>(
  (value) => (typeof value === 'number' || typeof value === 'string' ? value : undefined),
  'expected option index or option text',
)

const richOption = v.object<RichOption>({
  text: v.string(),
  next: v.optional(v.string()),
  explanation: v.optional(v.string()),
})

const schema = v.object<QuizProps>({
  title: v.optional(v.string()),
  mode: v.optional(v.enum(['list', 'step'] as const)),
  questions: v.array(
    v.object<QuizQuestion>({
      id: v.optional(v.string()),
      question: v.string(),
      image: v.optional(v.string()),
      options: v.array(v.union<RawOption>(v.string(), richOption), { min: 2, max: 10 }),
      answer: v.optional(v.union<RawAnswer | RawAnswer[]>(rawAnswer, v.array(rawAnswer, { min: 1 }))),
      explanation: v.optional(v.string()),
      next: v.optional(v.string()),
    }),
    { min: 1, max: 50 },
  ),
})

const LETTER_PREFIX = /^\s*\(?([A-Za-z])[).:：、．]\s+/
const LETTER_ONLY = /^\(?([A-Za-z])\)?[.:：、．]?$/

/** Models often write "A. Paris"; the badge already shows the letter, so drop a consistent prefix. */
export function stripLetterPrefixes(options: string[]): string[] {
  const consistent = options.every((option, index) => {
    const match = LETTER_PREFIX.exec(option)
    return match && match[1].toUpperCase().charCodeAt(0) - 65 === index
  })
  return consistent ? options.map((option) => option.replace(LETTER_PREFIX, '')) : options
}

/** 0-based index, exact option text, or a letter ("B", "b)", "C."); anything else is ungraded. */
export function resolveAnswer(raw: RawAnswer, options: string[]): number | null {
  if (typeof raw === 'number') return Number.isInteger(raw) && raw >= 0 && raw < options.length ? raw : null
  const text = raw.trim()
  const normalized = text.toLowerCase()
  const exact = options.findIndex((option) => option.trim().toLowerCase() === normalized)
  if (exact >= 0) return exact
  const stripped = stripLetterPrefixes(options).findIndex((option) => option.trim().toLowerCase() === normalized)
  if (stripped >= 0) return stripped
  const letter = LETTER_ONLY.exec(text)
  if (letter) {
    const index = letter[1].toUpperCase().charCodeAt(0) - 65
    return index < options.length ? index : null
  }
  if (/^\d+$/.test(text)) {
    const index = Number(text)
    return index < options.length ? index : null
  }
  return null
}

type PreparedOption = { text: string; next?: string; explanation?: string }
type PreparedQuestion = Omit<QuizQuestion, 'options'> & {
  options: PreparedOption[]
  correct: number[] | null
  multi: boolean
  safeImage?: string
}

function prepare(question: QuizQuestion): PreparedQuestion {
  const rawTexts = question.options.map((o) => (typeof o === 'string' ? o : o.text))
  const stripped = stripLetterPrefixes(rawTexts)
  const options: PreparedOption[] = question.options.map((o, i) =>
    typeof o === 'string'
      ? { text: stripped[i] ?? o }
      : { text: stripped[i] ?? o.text, next: o.next, explanation: o.explanation },
  )
  const list = question.answer === undefined ? [] : Array.isArray(question.answer) ? question.answer : [question.answer]
  const resolved = [
    ...new Set(
      list.map((entry) => resolveAnswer(entry, rawTexts)).filter((index): index is number => index != null),
    ),
  ]
  const correct = resolved.length ? resolved.sort((a, b) => a - b) : null
  return {
    ...question,
    options,
    correct,
    multi: (correct?.length ?? 0) > 1,
    safeImage: safeBlockImageUrl(question.image),
  }
}

function sameSet(a: number[], b: number[]): boolean {
  return a.length === b.length && a.every((value) => b.includes(value))
}

type Verdict = 'right' | 'wrong' | 'answered'

function verdictOf(question: PreparedQuestion, picked: number[] | undefined): Verdict | undefined {
  if (!picked) return undefined
  if (!question.correct) return 'answered'
  return sameSet(picked, question.correct) ? 'right' : 'wrong'
}

const QuestionCard = memo(function QuestionCard({
  question,
  index,
  picked,
  onCommit,
}: {
  question: PreparedQuestion
  index: number
  picked: number[] | undefined
  onCommit: (index: number, picked: number[]) => void
}) {
  const { t } = useTranslation()
  const [draft, setDraft] = useState<number[]>([])
  const [zoomImg, setZoomImg] = useState(false)
  const answered = picked !== undefined
  const verdict = verdictOf(question, picked)
  const pickedOptExplain = answered && picked.length === 1 ? question.options[picked[0]]?.explanation : undefined
  const explainText = pickedOptExplain || question.explanation

  return (
    <div className="uib-quiz-q" data-verdict={verdict}>
      <div className="uib-quiz-question">
        <span className="uib-quiz-no">{index + 1}</span>
        <span>{question.question}</span>
        {question.multi ? <span className="uib-chip">{t('timeline:uiBlock.multiSelect')}</span> : null}
      </div>
      {question.safeImage ? (
        <div className="uib-quiz-image-wrap">
          <button type="button" onClick={() => setZoomImg(true)} className="uib-quiz-image-btn">
            <img src={question.safeImage} alt={question.question} loading="lazy" />
          </button>
          <ImageLightbox
            images={[{ src: question.safeImage, alt: question.question }]}
            index={zoomImg ? 0 : null}
            onIndexChange={(next) => {
              if (next === null) setZoomImg(false)
            }}
          />
        </div>
      ) : null}
      <div className="uib-quiz-options" role={question.multi ? 'group' : 'radiogroup'}>
        {question.options.map((option, at) => {
          const chosen = answered ? picked.includes(at) : draft.includes(at)
          const isCorrect = answered && !!question.correct?.includes(at)
          const state = answered
            ? isCorrect
              ? 'correct'
              : chosen
                ? question.correct
                  ? 'wrong'
                  : 'chosen'
                : 'rest'
            : chosen
              ? 'chosen'
              : undefined
          return (
            <button
              key={at}
              type="button"
              role={question.multi ? 'checkbox' : 'radio'}
              aria-checked={chosen}
              className="uib-quiz-opt"
              data-state={state}
              disabled={answered}
              onClick={() => {
                if (!question.multi) onCommit(index, [at])
                else
                  setDraft((previous) =>
                    previous.includes(at) ? previous.filter((item) => item !== at) : [...previous, at],
                  )
              }}
            >
              <span className="uib-quiz-letter" aria-hidden>
                {state === 'correct' ? <Check /> : state === 'wrong' ? <X /> : String.fromCharCode(65 + at)}
              </span>
              <span className="uib-quiz-opt-text">{option.text}</span>
            </button>
          )
        })}
      </div>
      {question.multi && !answered ? (
        <div className="uib-quiz-row">
          <button
            type="button"
            className="uib-btn uib-btn-primary"
            disabled={draft.length === 0}
            onClick={() => onCommit(index, [...draft].sort((a, b) => a - b))}
          >
            {t('timeline:uiBlock.check')}
          </button>
        </div>
      ) : null}
      {answered && (explainText || verdict !== 'answered') ? (
        <div className="uib-quiz-explain" data-verdict={verdict}>
          {verdict === 'right' || verdict === 'wrong' ? (
            <strong>{verdict === 'right' ? t('timeline:uiBlock.correct') : t('timeline:uiBlock.incorrect')}</strong>
          ) : null}
          {explainText ? <span>{explainText}</span> : null}
        </div>
      ) : null}
    </div>
  )
})

function ScoreSummary({
  questions,
  answers,
  score,
  graded,
  onReview,
  onRestart,
}: {
  questions: PreparedQuestion[]
  answers: Record<number, number[]>
  score: number
  graded: number
  onReview?: (index: number) => void
  onRestart: () => void
}) {
  const { t } = useTranslation()
  const ratio = graded ? score / graded : 1
  return (
    <div className="uib-quiz-summary uib-step-in">
      <svg className="uib-quiz-ring" viewBox="0 0 36 36" aria-hidden>
        <circle className="uib-quiz-ring-track" cx="18" cy="18" r="15.5" />
        <circle
          className="uib-quiz-ring-value"
          cx="18"
          cy="18"
          r="15.5"
          pathLength={1}
          style={{ '--ratio': ratio } as CSSProperties}
          data-tone={ratio >= 0.8 ? 'good' : ratio >= 0.5 ? 'mid' : 'low'}
        />
      </svg>
      <div className="uib-quiz-summary-body">
        <div className="uib-quiz-score">
          {graded ? (
            <>
              <span>{score}</span>
              <span className="uib-muted"> / {graded}</span>
            </>
          ) : (
            t('timeline:uiBlock.allAnswered')
          )}
        </div>
        <div className="uib-quiz-dots">
          {questions.map((question, index) => (
            <button
              key={index}
              type="button"
              className="uib-quiz-dot"
              data-verdict={verdictOf(question, answers[index])}
              onClick={onReview ? () => onReview(index) : undefined}
              disabled={!onReview}
              aria-label={`${index + 1}`}
            />
          ))}
        </div>
      </div>
      <button type="button" className="uib-btn" onClick={onRestart}>
        <RotateCcw />
        {t('timeline:uiBlock.restart')}
      </button>
    </div>
  )
}

function Quiz({ props, blockKey, animate }: UIBlockComponentProps<QuizProps>) {
  const { t } = useTranslation()
  const questions = useMemo(() => props.questions.map(prepare), [props.questions])
  const hasBranching = useMemo(
    () => questions.some((q) => Boolean(q.next) || q.options.some((o) => Boolean(o.next))),
    [questions],
  )
  const indexById = useMemo(() => {
    const map = new Map<string, number>()
    questions.forEach((q, idx) => {
      if (q.id) map.set(q.id, idx)
    })
    return map
  }, [questions])

  const mode = hasBranching ? 'step' : (props.mode ?? (questions.length > 3 ? 'step' : 'list'))
  const [answers, setAnswers] = useBlockState<Record<number, number[]>>(blockKey, 'answers', {})
  const [step, setStepState] = useBlockState<number>(blockKey, 'step', 0)
  const [trail, setTrail] = useBlockState<number[]>(blockKey, 'trail', [0])
  const navigated = useRef(false)

  const setStep = useCallback(
    (next: number) => {
      navigated.current = true
      setStepState(next)
    },
    [setStepState],
  )

  const resolveNextIndex = useCallback(
    (currentIdx: number, picked?: number[]): number => {
      const q = questions[currentIdx]
      const target =
        (picked && picked.length === 1 ? q?.options[picked[0]]?.next : undefined) ?? q?.next
      if (target) {
        if (target.toLowerCase() === 'end') return questions.length
        const mapped = indexById.get(target)
        if (mapped !== undefined) return mapped
      }
      return currentIdx + 1
    },
    [indexById, questions],
  )

  const commit = useCallback(
    (index: number, picked: number[]) =>
      setAnswers((previous) => (previous[index] ? previous : { ...previous, [index]: picked })),
    [setAnswers],
  )

  const restart = () => {
    setAnswers({})
    setStep(0)
    setTrail([0])
  }

  const answered = questions.filter((_, index) => answers[index]).length
  const graded = questions.filter((question) => question.correct).length
  const score = questions.reduce(
    (sum, question, index) => sum + (verdictOf(question, answers[index]) === 'right' ? 1 : 0),
    0,
  )
  const done = hasBranching ? step >= questions.length : answered === questions.length

  const actions = (
    <>
      <span className="uib-muted uib-quiz-count">
        {done && graded ? t('timeline:uiBlock.score', { score, total: graded }) : `${answered}/${questions.length}`}
      </span>
      {answered > 0 ? (
        <button
          type="button"
          className="uib-icon-btn"
          onClick={restart}
          aria-label={t('timeline:uiBlock.restart')}
          title={t('timeline:uiBlock.restart')}
        >
          <RotateCcw />
        </button>
      ) : null}
    </>
  )

  if (mode === 'list') {
    return (
      <BlockFrame title={props.title} animate={animate} actions={actions}>
        <div className="uib-quiz-list">
          {questions.map((question, index) => (
            <QuestionCard key={index} question={question} index={index} picked={answers[index]} onCommit={commit} />
          ))}
        </div>
        {done && graded ? (
          <ScoreSummary questions={questions} answers={answers} score={score} graded={graded} onRestart={restart} />
        ) : null}
      </BlockFrame>
    )
  }

  const current = Math.min(step, questions.length)
  const onSummary = current >= questions.length && (hasBranching || done)
  const index = onSummary ? questions.length - 1 : Math.min(current, questions.length - 1)
  const nextIndex = resolveNextIndex(index, answers[index])
  const last = nextIndex >= questions.length

  const goBack = () => {
    if (hasBranching && trail.length > 1) {
      const nextTrail = trail.slice(0, -1)
      setTrail(nextTrail)
      setStep(nextTrail[nextTrail.length - 1] ?? 0)
    } else if (index > 0) {
      setStep(index - 1)
    }
  }

  const goForward = () => {
    if (hasBranching) {
      setTrail((prev) => (prev[prev.length - 1] === nextIndex ? prev : [...prev, nextIndex]))
    }
    setStep(nextIndex)
  }

  return (
    <BlockFrame title={props.title} animate={animate} actions={actions}>
      <div className="uib-quiz-progress" aria-hidden>
        <span style={{ transform: `scaleX(${Math.min(1, answered / questions.length)})` }} />
      </div>
      {onSummary ? (
        <ScoreSummary
          questions={questions}
          answers={answers}
          score={score}
          graded={graded}
          onReview={setStep}
          onRestart={restart}
        />
      ) : (
        <>
          <div key={index} className={navigated.current ? 'uib-step-in' : undefined}>
            <QuestionCard question={questions[index]} index={index} picked={answers[index]} onCommit={commit} />
          </div>
          <div className="uib-quiz-nav">
            <button
              type="button"
              className="uib-icon-btn"
              disabled={hasBranching ? trail.length <= 1 : index === 0}
              onClick={goBack}
              aria-label={t('timeline:uiBlock.prev')}
            >
              <ChevronLeft />
            </button>
            <span className="uib-muted">
              {index + 1} / {questions.length}
            </span>
            {last ? (
              <button
                type="button"
                className="uib-btn uib-btn-primary"
                disabled={!answers[index]}
                onClick={goForward}
              >
                {t('timeline:uiBlock.seeResult')}
              </button>
            ) : (
              <button type="button" className="uib-btn" disabled={!answers[index]} onClick={goForward}>
                {t('timeline:uiBlock.next')}
                <ChevronRight />
              </button>
            )}
          </div>
        </>
      )}
    </BlockFrame>
  )
}

export const quizDefinition: UIBlockDefinition<QuizProps> = {
  name: 'quiz',
  schema,
  Component: Quiz,
  skeleton: 'block',
}
