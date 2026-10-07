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

  it('reads pi-goal-x task lists from goal tool details, mapping complete / skipped', () => {
    const adapter = resolveWidgetAdapterByTool('update_goal_task')
    expect(adapter?.id).toBe('pi-goal-x')
    expect(
      normalizeTodoWidgetItems(
        {
          version: 3,
          goal: {
            taskList: {
              tasks: [
                { id: 't1', title: 'Write tests', status: 'complete' },
                { id: 't2', title: 'Ship', status: 'pending' },
                { id: 't3', title: 'Drop legacy', status: 'skipped' },
              ],
            },
          },
        },
        adapter?.widget,
      ),
    ).toEqual([
      { id: 't1', text: 'Write tests', status: 'completed' },
      { id: 't2', text: 'Ship', status: 'pending' },
      { id: 't3', text: 'Drop legacy', status: 'cancelled' },
    ])
  })

  it('does not read other tools of a widget package as todo lists', () => {
    expect(resolveWidgetAdapterByTool('ctx_memory_list')).toBeNull()
    expect(resolveWidgetAdapterByTool('goal_question')).toBeNull()
  })
})
