import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import type { ExtensionWidgetEvent } from '@shared/app-events'
import { invalidateAdapterCatalog } from '../extension-compat/adapter-loader'
import { createDesktopWidgetHost } from './desktop-widget-host'

const tempDirs: string[] = []

afterEach(() => {
  invalidateAdapterCatalog()
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function host(projectDir?: string) {
  const events: ExtensionWidgetEvent[] = []
  let seq = 0
  const api = createDesktopWidgetHost({
    emit: (event) => events.push(event),
    baseEvent: () => ({
      seq: ++seq,
      workspaceId: projectDir || '/w',
      sessionId: 's',
      sessionFile: `${projectDir || '/w'}/s.jsonl`,
      timestamp: seq,
    }),
    projectDir,
    theme: { bold: (text: string) => text },
  })
  return { api, events }
}

describe('desktop widget host', () => {
  it('registers the official factory signature once and re-renders on requestRender', async () => {
    const { api, events } = host()
    let calls = 0
    let items = ['One']
    let requestRender: (() => void) | undefined
    let receivedTheme: unknown
    api.setWidget('magic-context-todos', (tui: { requestRender: () => void }, theme: unknown) => {
      calls += 1
      requestRender = tui.requestRender
      receivedTheme = theme
      return {
        render: () => items,
        invalidate: () => {},
      }
    })
    expect(calls).toBe(1)
    expect(receivedTheme).toEqual({ bold: expect.any(Function) })
    expect(events.at(-1)?.state?.payload.items[0]?.text).toBe('One')
    items = ['Two']
    requestRender?.()
    requestRender?.()
    await Promise.resolve()
    expect(calls).toBe(1)
    expect(events.at(-1)?.state?.payload.items[0]?.text).toBe('Two')
    api.dispose()
  })

  it('lets structured tool state win over widget text lines', () => {
    const { api, events } = host()
    api.setWidget('pi-deck-todo', ['visible only'])
    api.captureTool('todo', {
      todos: [
        { id: '1', text: 'Write', done: false },
        { id: '2', text: 'Ship', done: true },
      ],
    })
    const last = events.at(-1)
    expect(last?.state?.payload.items).toHaveLength(2)
    expect(last?.state?.payload.items.map((item) => item.status)).toEqual(['pending', 'completed'])
    api.setWidget('pi-deck-todo', undefined)
    expect(events.at(-1)?.phase).toBe('clear')
  })

  it('loads project-level widget adapters from the active workspace', () => {
    const projectDir = mkdtempSync(join(tmpdir(), 'pi-widget-adapter-'))
    tempDirs.push(projectDir)
    const adapterDir = join(projectDir, '.pi', 'desktop', 'adapters')
    mkdirSync(adapterDir, { recursive: true })
    writeFileSync(join(adapterDir, 'project-tasks.adapter.json'), JSON.stringify({
      id: 'project-tasks',
      displayName: 'Project tasks',
      match: { names: ['project-tasks'] },
      tier: 'partial',
      widget: {
        keys: ['project-task-widget'],
        placement: 'aboveComposer',
        protocol: 'todo-list-v1',
        title: 'Project tasks',
        fields: { items: 'items', text: 'text', status: 'status' },
      },
    }))
    invalidateAdapterCatalog()

    const { api, events } = host(projectDir)
    api.setWidget('project-task-widget', ['From project adapter'])

    expect(events.at(-1)).toEqual(expect.objectContaining({
      adapterId: 'project-tasks',
      protocol: 'todo-list-v1',
      state: expect.objectContaining({ title: 'Project tasks' }),
    }))
  })

  it('clears every published widget before disposal', () => {
    const { api, events } = host()
    api.setWidget('pi-deck-todo', ['Still visible'])

    api.dispose()

    expect(events.at(-1)).toEqual(expect.objectContaining({
      phase: 'clear',
      widgetKey: 'pi-deck-todo',
      adapterId: 'pi-deck-todo',
    }))
  })

  it('reconstructs official toolResult messages from the latest branch entry', () => {
    const { api, events } = host()
    api.reconstructFromBranch([
      {
        type: 'message',
        message: {
          role: 'toolResult',
          toolName: 'todo',
          details: { todos: [{ id: 'official', text: 'Restored from history', done: false }] },
        },
      },
    ])

    expect(events.at(-1)?.state?.payload.items[0]?.text).toBe('Restored from history')
  })

  it('reconstructs from the latest matching branch custom snapshot', () => {
    const { api, events } = host()
    api.reconstructFromBranch([
      { type: 'custom', customType: 'pi-deck-todo', data: { todos: [{ id: 'old', text: 'Old', done: true }] } },
      { type: 'custom', customType: 'pi-deck-todo', data: { todos: [{ id: 'new', text: 'New', done: false }] } },
    ])
    expect(events.at(-1)?.state?.payload.items[0]?.text).toBe('New')
  })
})
