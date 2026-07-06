import { describe, expect, it } from 'vitest'
import { pickSessionListTitle } from './session-list-title'

describe('pickSessionListTitle', () => {
  it('prefers pi JSONL name over overlay', () => {
    expect(pickSessionListTitle('first msg', 'From TUI', 'GUI only')).toBe('From TUI')
  })

  it('uses overlay when no pi name', () => {
    expect(pickSessionListTitle('fallback', undefined, 'GUI only')).toBe('GUI only')
  })

  it('uses sdkTitle when no name and no overlay', () => {
    expect(pickSessionListTitle('hello world')).toBe('hello world')
  })
})