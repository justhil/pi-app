import { describe, expect, it } from 'vitest'
import { extractTodoItems } from './todo-list'

describe('todo-list-v1 normalizer', () => {
  it('maps PiDeck done flags and Magic Context statuses', () => {
    expect(
      extractTodoItems({
        todos: [
          { id: 'a', text: 'Write tests', done: false },
          { id: 'b', text: 'Ship it', done: true },
        ],
      }),
    ).toEqual([
      { id: 'a', text: 'Write tests', status: 'pending' },
      { id: 'b', text: 'Ship it', status: 'completed' },
    ])

    expect(
      extractTodoItems(
        {
          todos: [
            { id: '1', content: 'Normalize', status: 'in_progress', priority: 'high' },
            { content: 'Skip me', status: 'wat' },
            { id: '2', content: 'Done', status: 'completed' },
            { id: '3', content: 'Nope', status: 'cancelled' },
          ],
        },
        { text: 'content' },
      ),
    ).toEqual([
      { id: '1', text: 'Normalize', status: 'in_progress', priority: 'high' },
      { id: '2', text: 'Done', status: 'completed' },
      { id: '3', text: 'Nope', status: 'cancelled' },
    ])
  })

  it('returns null for malformed payloads and empty arrays as a real clear', () => {
    expect(extractTodoItems({ todos: 'nope' })).toBeNull()
    expect(extractTodoItems({ todos: [{ status: 'pending' }] })).toBeNull()
    expect(extractTodoItems({ todos: [] })).toEqual([])
  })
})
