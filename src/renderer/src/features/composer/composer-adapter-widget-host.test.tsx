import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ComposerAdapterWidgetHost } from './composer-adapter-widget-host'

const state = {
  composerWidget: null as null | {
    protocol: 'todo-list-v1'
    widgetKey: string
    adapterId: string
    title: string
    payload: {
      items: Array<{ id: string; text: string; status: 'pending' | 'in_progress' | 'completed' | 'cancelled' }>
    }
    updatedAt: number
  },
  historySessionFile: '/s.jsonl',
  adapterWidgetExpandedBySession: {} as Record<string, boolean>,
  toggleAdapterWidget: vi.fn((key: string) => {
    state.adapterWidgetExpandedBySession[key] = !state.adapterWidgetExpandedBySession[key]
  }),
}

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, values?: Record<string, unknown>) => values ? `${key}:${JSON.stringify(values)}` : key }),
}))

vi.mock('@renderer/stores/ui-store', () => ({
  useUIStore: (selector: (s: typeof state) => unknown) => selector(state),
}))

describe('ComposerAdapterWidgetHost', () => {
  beforeEach(() => {
    state.composerWidget = null
    state.adapterWidgetExpandedBySession = {}
    state.toggleAdapterWidget.mockClear()
  })

  it('renders nothing until an adapter publishes a supported widget', () => {
    const { container } = render(<ComposerAdapterWidgetHost />)
    expect(container).toBeEmptyDOMElement()
  })

  it('keeps the adapter widget compact until the user expands it', () => {
    state.composerWidget = {
      protocol: 'todo-list-v1',
      widgetKey: 'magic-context-todos',
      adapterId: 'magic-context-todo',
      title: 'Todo',
      payload: {
        items: [
          { id: '1', text: 'Write tests', status: 'in_progress' },
          { id: '2', text: 'Ship', status: 'completed' },
        ],
      },
      updatedAt: 1,
    }
    const { rerender } = render(<ComposerAdapterWidgetHost />)

    const trigger = screen.getByRole('button', { name: /Todo/ })
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    expect(trigger.closest('section')).toHaveClass('adapter-widget-shell', 'min-w-0')
    expect(trigger).toHaveClass('h-7')
    // Collapsed tray: progress ring plus the item being worked on, but no list.
    expect(document.querySelector('.adapter-widget-ring')).toBeInTheDocument()
    expect(trigger).toHaveTextContent('1/2')
    expect(trigger).toHaveTextContent(/Write tests/)
    expect(document.querySelector('.adapter-widget-list')).not.toBeInTheDocument()

    fireEvent.click(trigger)
    expect(state.toggleAdapterWidget).toHaveBeenCalledWith('/s.jsonl\u0000magic-context-todos')
    state.adapterWidgetExpandedBySession['/s.jsonl\u0000magic-context-todos'] = true
    rerender(<ComposerAdapterWidgetHost />)

    const list = document.querySelector('.adapter-widget-list') as HTMLElement
    expect(list).toBeInTheDocument()
    expect(list).toHaveTextContent('Write tests')
    expect(list).toHaveTextContent('Ship')
  })

  it('shows a finished state when every item is done', () => {
    state.composerWidget = {
      protocol: 'todo-list-v1',
      widgetKey: 'magic-context-todos',
      adapterId: 'magic-context-todo',
      title: 'Todo',
      payload: { items: [{ id: '1', text: 'Ship', status: 'completed' }, { id: '2', text: 'Old plan', status: 'cancelled' }] },
      updatedAt: 1,
    }
    render(<ComposerAdapterWidgetHost />)
    const trigger = screen.getByRole('button', { name: /Todo/ })
    expect(trigger).toHaveTextContent('1/2')
    expect(document.querySelector('.adapter-widget-ring')).not.toBeInTheDocument()
    expect(document.querySelector('[data-done="true"]')).toBeInTheDocument()
  })
})
