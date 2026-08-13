import { describe, expect, it } from 'vitest'
import {
  normalizeTodoWidgetItems,
  resolveWidgetAdapterByKey,
  resolveWidgetAdapterByTool,
} from './todo-widget'

describe('todo widget adapters', () => {
  it('resolves both builtin Todo adapters without package-name branches', () => {
    expect(resolveWidgetAdapterByTool('todo')?.id).toBe('pi-deck-todo')
    expect(resolveWidgetAdapterByKey('pi-deck-todo')?.id).toBe('pi-deck-todo')
    expect(resolveWidgetAdapterByTool('todowrite')?.id).toBe('magic-context-todo')
    expect(resolveWidgetAdapterByKey('magic-context-todos')?.id).toBe('magic-context-todo')
  })

  it('normalizes through the declared field map', () => {
    const adapter = resolveWidgetAdapterByTool('todowrite')
    expect(
      normalizeTodoWidgetItems(
        { todos: [{ content: 'Keep going', status: 'in_progress' }] },
        adapter?.widget,
      ),
    ).toEqual([{ id: 'todo-1', text: 'Keep going', status: 'in_progress' }])
  })
})
