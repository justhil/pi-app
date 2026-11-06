import { describe, expect, it } from 'vitest'
import {
  normalizeTodoWidgetItems,
  resolveWidgetAdapterByKey,
  resolveWidgetAdapterByTool,
  todoItemsFromTextLines,
} from './todo-widget'
import { parseAdapterDeclaration } from './adapter-validation'

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

  it('reads status and id from magic-context overlay lines, skipping heading and overflow', () => {
    const widget = resolveWidgetAdapterByKey('magic-context-todos')?.widget
    const lines = [
      '[33m●[0m Todos — 1/4 completed · 1 in progress · 1 pending',
      '├─ ✓ #t1 Read the adapter',
      '├─ ◐ #t2 Fix the binding order',
      '├─ ○ Write tests',
      '└─ +1 more',
    ]
    expect(todoItemsFromTextLines(lines, 'magic-context-todos', widget)).toEqual([
      { id: 't1', text: 'Read the adapter', status: 'completed' },
      { id: 't2', text: 'Fix the binding order', status: 'in_progress' },
      { id: 'magic-context-todos-3', text: 'Write tests', status: 'pending' },
    ])
  })

  it('keeps plain text widgets as pending rows without a textLines declaration', () => {
    expect(todoItemsFromTextLines(['One', '', '  Two  '], 'k')).toEqual([
      { id: 'k-0', text: 'One', status: 'pending' },
      { id: 'k-2', text: 'Two', status: 'pending' },
    ])
  })

  it('rejects textLines with an invalid pattern or status', () => {
    const base = { id: 'x', tier: 'partial', match: { names: ['x'] }, widget: { placement: 'aboveComposer', protocol: 'todo-list-v1' } }
    const withLines = (textLines: unknown) => parseAdapterDeclaration({ ...base, widget: { ...base.widget, textLines } })
    expect('adapter' in withLines({ skip: ['^ok$'], status: { '✓': 'completed' } })).toBe(true)
    expect('error' in withLines({ strip: '([' })).toBe(true)
    expect('error' in withLines({ status: { '✓': 'finished' } })).toBe(true)
  })
})
