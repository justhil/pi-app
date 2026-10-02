import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import i18n from '@renderer/lib/i18n'
import { QuestionnaireDialog, type AskQuestionPayload } from '../questionnaire-dialog'
import { buildAnswers, loadDrafts } from '../questionnaire-model'

const questions: AskQuestionPayload[] = [
  { question: 'Which database?', header: 'Storage', options: [{ label: 'SQLite' }, { label: 'Postgres', description: 'Server' }] },
  { question: 'Which features?', header: 'Scope', multiSelect: true, options: [{ label: 'Auth' }, { label: 'Billing' }, { label: 'Search' }] },
  { question: 'Ship when?', options: [{ label: 'Today' }, { label: 'Next week' }] },
]

function setup(id = 'req-1', qs = questions) {
  const onSubmit = vi.fn()
  const onSuspend = vi.fn()
  const onCancel = vi.fn()
  const view = render(<QuestionnaireDialog requestId={id} questions={qs} onSubmit={onSubmit} onSuspend={onSuspend} onCancel={onCancel} />)
  return { ...view, onSubmit, onSuspend, onCancel }
}

const title = () => screen.getByRole('heading', { level: 2 }).textContent

beforeAll(async () => {
  await i18n.changeLanguage('en')
})
afterEach(() => vi.useRealTimers())

describe('QuestionnaireDialog', () => {
  it('advances after a single-choice pick but never submits by itself', () => {
    vi.useFakeTimers()
    const { onSubmit } = setup()
    fireEvent.click(screen.getByRole('radio', { name: /SQLite/ }))
    expect(title()).toBe('Which database?')
    act(() => vi.advanceTimersByTime(300))
    expect(title()).toBe('Which features?')

    fireEvent.click(screen.getByRole('checkbox', { name: /Search/ }))
    fireEvent.click(screen.getByRole('checkbox', { name: /Auth/ }))
    expect(title()).toBe('Which features?')
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))

    fireEvent.click(screen.getByRole('radio', { name: /Today/ }))
    act(() => vi.advanceTimersByTime(300))
    expect(title()).toBe('Ship when?')
    expect(onSubmit).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Submit' }))
    expect(onSubmit).toHaveBeenCalledWith({
      cancelled: false,
      answers: [
        { questionIndex: 0, question: 'Which database?', kind: 'option', answer: 'SQLite' },
        // Option order, not click order.
        { questionIndex: 1, question: 'Which features?', kind: 'multi', answer: null, selected: ['Auth', 'Search'] },
        { questionIndex: 2, question: 'Ship when?', kind: 'option', answer: 'Today' },
      ],
    })
  })

  it('sends submit to the first unanswered question instead of submitting blanks', () => {
    const { onSubmit } = setup('req-2')
    fireEvent.click(screen.getByRole('button', { name: /Ship when|^3$/ }))
    fireEvent.click(screen.getByRole('radio', { name: /Next week/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }))
    expect(onSubmit).not.toHaveBeenCalled()
    expect(title()).toBe('Which database?')
    expect(screen.getByRole('status').textContent).toBe('2 questions unanswered')
  })

  it('keeps keyboard focus on the dialog after jumping with a step tab', () => {
    setup('req-8')
    const tab = screen.getByRole('button', { name: /Scope/ })
    const event = new MouseEvent('mousedown', { bubbles: true, cancelable: true })
    tab.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
    fireEvent.click(tab)
    expect(title()).toBe('Which features?')
  })

  it('treats the custom answer as its own choice', () => {
    vi.useFakeTimers()
    const { onSubmit } = setup('req-3', [questions[0]])
    fireEvent.click(screen.getByRole('radio', { name: /Postgres/ }))
    fireEvent.click(screen.getByRole('radio', { name: /Other/ }))
    expect(screen.getByRole('radio', { name: /Postgres/ })).toHaveAttribute('aria-checked', 'false')
    fireEvent.change(screen.getByPlaceholderText('Type your answer'), { target: { value: '  DuckDB  ' } })
    fireEvent.keyDown(screen.getByPlaceholderText('Type your answer'), { key: 'Enter', ctrlKey: true })
    expect(onSubmit).toHaveBeenCalledWith({
      cancelled: false,
      answers: [{ questionIndex: 0, question: 'Which database?', kind: 'custom', answer: 'DuckDB' }],
    })
  })

  it('supports number keys and Enter', () => {
    vi.useFakeTimers()
    const { onSubmit } = setup('req-4', [questions[0], questions[2]])
    const dialog = screen.getByRole('dialog')
    fireEvent.keyDown(dialog, { key: '2' })
    act(() => vi.advanceTimersByTime(300))
    expect(title()).toBe('Ship when?')
    fireEvent.keyDown(dialog, { key: '1' })
    fireEvent.keyDown(dialog, { key: 'Enter' })
    expect(onSubmit.mock.calls[0][0].answers.map((a: { answer: string }) => a.answer)).toEqual(['Postgres', 'Today'])
  })

  it('keeps the keys working after the focused option is replaced by the next question', () => {
    vi.useFakeTimers()
    const { onSubmit } = setup('req-9', [questions[0], questions[2]])
    const sqlite = screen.getByRole('radio', { name: /SQLite/ })
    sqlite.focus()
    fireEvent.click(sqlite)
    act(() => vi.advanceTimersByTime(300))
    expect(document.activeElement).toBe(screen.getByRole('dialog'))
    fireEvent.keyDown(document.activeElement!, { key: 'Enter' })
    expect(onSubmit).not.toHaveBeenCalled()
    expect(screen.getByRole('status').textContent).toBe('1 question unanswered')
  })

  it('keeps a draft across answer-later and resumes at the first open question', () => {
    vi.useFakeTimers()
    const first = setup('req-5')
    fireEvent.click(screen.getByRole('radio', { name: /Postgres/ }))
    act(() => vi.advanceTimersByTime(300))
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(first.onSuspend).toHaveBeenCalled()
    first.unmount()

    setup('req-5')
    expect(title()).toBe('Which features?')
    expect(buildAnswers(questions, loadDrafts('req-5', 3))[0]).toMatchObject({ answer: 'Postgres' })
    fireEvent.click(screen.getByRole('button', { name: /Storage/ }))
    expect(screen.getByRole('radio', { name: /Postgres/ })).toHaveAttribute('aria-checked', 'true')
  })

  it('drops the draft when the questionnaire is cancelled', () => {
    const { onCancel } = setup('req-6')
    fireEvent.click(screen.getByRole('radio', { name: /SQLite/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel (notify extension)' }))
    expect(onCancel).toHaveBeenCalled()
    expect(loadDrafts('req-6', 3)[0].selected).toEqual([])
  })

  it('renders no hard-coded Chinese in English', () => {
    const { baseElement } = setup('req-7')
    const attrs = [...baseElement.querySelectorAll('[title],[aria-label],[placeholder]')].map(
      (el) => `${el.getAttribute('title')} ${el.getAttribute('aria-label')} ${el.getAttribute('placeholder')}`,
    )
    expect(`${baseElement.textContent} ${attrs.join(' ')}`).not.toMatch(/[一-鿿]/)
  })
})
