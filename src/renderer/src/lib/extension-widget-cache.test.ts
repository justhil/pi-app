import { describe, expect, it } from 'vitest'
import type { ExtensionWidgetEvent } from '@shared/app-events'
import {
  applyExtensionWidgetEvent,
  clearSessionWidgets,
  getSessionComposerWidget,
} from './extension-widget-cache'

function event(partial: Partial<ExtensionWidgetEvent>): ExtensionWidgetEvent {
  return {
    type: 'extension_widget',
    phase: 'set',
    widgetKey: 'pi-deck-todo',
    adapterId: 'pi-deck-todo',
    protocol: 'todo-list-v1',
    seq: 1,
    workspaceId: '/w',
    sessionFile: '/a.jsonl',
    timestamp: 1,
    state: {
      adapterId: 'pi-deck-todo',
      widgetKey: 'pi-deck-todo',
      protocol: 'todo-list-v1',
      title: 'Todo',
      payload: { items: [{ id: '1', text: 'New', status: 'pending' }] },
      updatedAt: 1,
    },
    ...partial,
  }
}

describe('extension widget cache', () => {
  it('rejects stale seq and isolates sessions', () => {
    clearSessionWidgets('/a.jsonl')
    clearSessionWidgets('/b.jsonl')
    applyExtensionWidgetEvent(event({ seq: 2 }))
    applyExtensionWidgetEvent(
      event({
        seq: 1,
        state: {
          adapterId: 'pi-deck-todo',
          widgetKey: 'pi-deck-todo',
          protocol: 'todo-list-v1',
          title: 'Todo',
          payload: { items: [{ id: 'old', text: 'Old', status: 'completed' }] },
          updatedAt: 1,
        },
      }),
    )
    expect(getSessionComposerWidget('/a.jsonl')?.payload.items[0]?.text).toBe('New')

    applyExtensionWidgetEvent(event({ sessionFile: '/b.jsonl', seq: 3 }))
    expect(getSessionComposerWidget('/a.jsonl')?.payload.items[0]?.text).toBe('New')
    expect(getSessionComposerWidget('/b.jsonl')?.payload.items[0]?.text).toBe('New')
  })

  it('accepts a respawned worker whose seq restarted below the cached one', () => {
    clearSessionWidgets('/a.jsonl')
    applyExtensionWidgetEvent(event({ seq: 5000, timestamp: 100 }))
    const fresh = event({
      seq: 3,
      timestamp: 200,
      state: {
        adapterId: 'pi-deck-todo',
        widgetKey: 'pi-deck-todo',
        protocol: 'todo-list-v1',
        title: 'Todo',
        payload: { items: [{ id: '2', text: 'After restart', status: 'in_progress' }] },
        updatedAt: 200,
      },
    })
    applyExtensionWidgetEvent(fresh)
    expect(getSessionComposerWidget('/a.jsonl')?.payload.items[0]?.text).toBe('After restart')

    // A late event of the old worker stays behind the newer write.
    applyExtensionWidgetEvent(event({ seq: 5001, timestamp: 150 }))
    expect(getSessionComposerWidget('/a.jsonl')?.payload.items[0]?.text).toBe('After restart')
    applyExtensionWidgetEvent(event({ seq: 4, timestamp: 300, phase: 'clear', state: undefined }))
    expect(getSessionComposerWidget('/a.jsonl')).toBeNull()
  })
})
