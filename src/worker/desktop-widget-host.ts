import type { AdapterWidgetProjection } from '@shared/adapter-widget'
import type { ExtensionWidgetEvent } from '@shared/app-events'
import {
  normalizeTodoWidgetItems,
  resolveWidgetAdapterByKey,
  resolveWidgetAdapterByTool,
  widgetAdapters,
} from '../extension-compat/todo-widget.js'

export type WidgetEmit = (event: ExtensionWidgetEvent) => void

type WidgetComponent = {
  render?: (width: number) => unknown
  dispose?: () => void
}

const RENDER_WIDTH = 80

export function createDesktopWidgetHost(deps: {
  emit: WidgetEmit
  baseEvent: () => Record<string, unknown>
  projectDir?: string
  theme: unknown
}): {
  setWidget: (key: string, content: unknown) => void
  captureTool: (toolName: string, payload: unknown) => void
  clearTool: (toolName: string) => void
  reconstructFromBranch: (entries: unknown[]) => void
  dispose: () => void
} {
  const factories = new Map<string, { component: WidgetComponent | null; tui: { requestRender: () => void } }>()
  const structured = new Map<string, AdapterWidgetProjection>()
  const published = new Map<string, string>()
  const renderQueued = new Set<string>()
  let disposed = false

  function emitState(state: AdapterWidgetProjection | null, widgetKey: string, adapterId: string, phase: 'set' | 'clear'): void {
    if (disposed) return
    if (phase === 'set') published.set(widgetKey, adapterId)
    else published.delete(widgetKey)
    deps.emit({
      ...(deps.baseEvent() as unknown as ExtensionWidgetEvent),
      type: 'extension_widget',
      phase,
      widgetKey,
      adapterId,
      protocol: 'todo-list-v1',
      state: state ?? undefined,
    })
  }

  function publish(
    adapterId: string,
    widgetKey: string,
    items: ReturnType<typeof normalizeTodoWidgetItems>,
    title: string,
    icon?: string,
    asStructured = false,
  ): void {
    if (items == null) return
    if (items.length === 0) {
      if (asStructured) structured.delete(widgetKey)
      emitState(null, widgetKey, adapterId, 'clear')
      return
    }
    const state: AdapterWidgetProjection = {
      adapterId,
      widgetKey,
      protocol: 'todo-list-v1',
      title,
      icon,
      payload: { items },
      updatedAt: Date.now(),
    }
    if (asStructured) structured.set(widgetKey, state)
    emitState(state, widgetKey, adapterId, 'set')
  }

  function captureFromPayload(adapter: NonNullable<ReturnType<typeof resolveWidgetAdapterByTool>>, payload: unknown): void {
    const widget = adapter.widget!
    const items = normalizeTodoWidgetItems(payload, widget)
    publish(
      adapter.id,
      widget.keys?.[0] || adapter.id,
      items,
      widget.title || adapter.displayName || 'Todo',
      widget.icon,
      true,
    )
  }

  function renderFactory(key: string): void {
    const adapter = resolveWidgetAdapterByKey(key, deps.projectDir)
    const slot = factories.get(key)
    if (!adapter?.widget || !slot?.component?.render) return
    if (structured.has(key)) return
    try {
      const lines = slot.component.render(RENDER_WIDTH)
      const textLines = Array.isArray(lines) ? lines.map((line) => String(line)) : [String(lines ?? '')]
      const items = textLines
        .map((line, index) => {
          const text = line.replace(/\x1b\[[0-9;]*m/g, '').trim()
          if (!text) return null
          return { id: `${key}-${index}`, text, status: 'pending' as const }
        })
        .filter((row): row is { id: string; text: string; status: 'pending' } => row != null)
      publish(adapter.id, key, items, adapter.widget.title || adapter.displayName || 'Todo', adapter.widget.icon)
    } catch {
      /* ignore factory render errors; keep last good state */
    }
  }

  function setWidget(key: string, content: unknown): void {
    const adapter = resolveWidgetAdapterByKey(key, deps.projectDir)
    const existing = factories.get(key)
    if (content == null) {
      existing?.component?.dispose?.()
      factories.delete(key)
      structured.delete(key)
      if (adapter) emitState(null, key, adapter.id, 'clear')
      return
    }
    if (!adapter?.widget) return

    if (typeof content === 'function') {
      existing?.component?.dispose?.()
      const tui = {
        requestRender: () => {
          if (disposed || renderQueued.has(key)) return
          renderQueued.add(key)
          queueMicrotask(() => {
            renderQueued.delete(key)
            if (!disposed) renderFactory(key)
          })
        },
      }
      let component: WidgetComponent | null = null
      try {
        component = content(tui, deps.theme) as WidgetComponent
      } catch {
        component = null
      }
      factories.set(key, { component, tui })
      renderFactory(key)
      return
    }

    if (Array.isArray(content) || typeof content === 'string') {
      const lines = Array.isArray(content) ? content : [content]
      const items = lines
        .map((line, index) => {
          const text = String(line || '').trim()
          if (!text) return null
          return { id: `${key}-${index}`, text, status: 'pending' as const }
        })
        .filter((row): row is { id: string; text: string; status: 'pending' } => row != null)
      if (!structured.has(key)) publish(adapter.id, key, items, adapter.widget.title || 'Todo', adapter.widget.icon)
      return
    }

    captureFromPayload(adapter, content)
  }

  function captureTool(toolName: string, payload: unknown): void {
    const adapter = resolveWidgetAdapterByTool(toolName, deps.projectDir)
    if (!adapter) return
    captureFromPayload(adapter, payload)
  }

  function clearTool(toolName: string): void {
    const adapter = resolveWidgetAdapterByTool(toolName, deps.projectDir)
    const key = adapter?.widget?.keys?.[0]
    if (!adapter || !key) return
    structured.delete(key)
    emitState(null, key, adapter.id, 'clear')
  }

  function reconstructFromBranch(entries: unknown[]): void {
    for (const adapter of widgetAdapters(deps.projectDir)) {
      if (!adapter.widget) continue
      const customType = adapter.widget.keys?.[0]
      for (let i = entries.length - 1; i >= 0; i--) {
        const entry = entries[i] as {
          type?: string
          customType?: string
          data?: unknown
          toolName?: string
          args?: unknown
          details?: unknown
          message?: {
            role?: string
            toolName?: string
            content?: unknown
            details?: unknown
          }
        }
        if (customType && (entry?.customType === customType || (entry?.type === 'custom' && entry.customType === customType))) {
          captureFromPayload(adapter, entry.data)
          break
        }
        const toolResult = entry?.type === 'message' && entry.message?.role === 'toolResult'
          ? entry.message
          : null
        const toolName = toolResult?.toolName ?? entry?.toolName
        if (toolName && adapter.widget.tools?.includes(toolName)) {
          captureFromPayload(adapter, toolResult?.details ?? toolResult?.content ?? entry.details ?? entry.args ?? entry)
          break
        }
      }
    }
  }

  function dispose(): void {
    for (const [key, adapterId] of published) emitState(null, key, adapterId, 'clear')
    disposed = true
    for (const slot of factories.values()) slot.component?.dispose?.()
    factories.clear()
    structured.clear()
    published.clear()
    renderQueued.clear()
  }

  return { setWidget, captureTool, clearTool, reconstructFromBranch, dispose }
}
