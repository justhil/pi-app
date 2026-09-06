import { describe, expect, it } from 'vitest'
import {
  countAttention,
  reduceSessionAttention,
  selectSessionAttention,
} from '../session-attention'

describe('reduceSessionAttention', () => {
  it('maps waiting UI over running to needs-you', () => {
    expect(
      reduceSessionAttention({
        running: true,
        waitingUi: true,
        settledUnseen: true,
        viewing: false,
      }),
    ).toBe('needs-you')
  })

  it('maps running without waiting to working', () => {
    expect(
      reduceSessionAttention({
        running: true,
        waitingUi: false,
        settledUnseen: false,
        viewing: false,
      }),
    ).toBe('working')
  })

  it('maps settled unseen to done', () => {
    expect(
      reduceSessionAttention({
        running: false,
        waitingUi: false,
        settledUnseen: true,
        viewing: false,
      }),
    ).toBe('done')
  })

  it('clears done when the session is the current view', () => {
    expect(
      reduceSessionAttention({
        running: false,
        waitingUi: false,
        settledUnseen: true,
        viewing: true,
      }),
    ).toBe('idle')
  })

  it('keeps confirm/input/select/image as waiting when waitingUi is set', () => {
    expect(
      reduceSessionAttention({
        running: false,
        waitingUi: true,
        settledUnseen: false,
        viewing: false,
      }),
    ).toBe('needs-you')
  })
})

describe('selectSessionAttention', () => {
  it('matches mixed path separators', () => {
    expect(
      selectSessionAttention('C:\\s\\a.jsonl', { 'C:/s/a.jsonl': 'working' }),
    ).toBe('working')
  })
})

describe('countAttention', () => {
  it('counts working and needs-you separately', () => {
    expect(
      countAttention({
        a: 'working',
        b: 'needs-you',
        c: 'done',
        d: 'idle',
      }),
    ).toEqual({ working: 1, needsYou: 1, done: 1 })
  })
})
