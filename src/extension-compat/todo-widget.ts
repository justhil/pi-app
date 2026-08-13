import { extractTodoItems, type TodoFieldMap, type TodoWidgetItem } from '@shared/todo-list'
import type { AdapterJson, AdapterWidgetDef } from './adapter-schema'
import { loadAdapterCatalog } from './adapter-loader'

export function widgetAdapters(projectDir?: string): AdapterJson[] {
  return loadAdapterCatalog(projectDir).adapters.filter(
    (adapter) => adapter.widget?.protocol === 'todo-list-v1' && adapter.widget.placement === 'aboveComposer',
  )
}

export function resolveWidgetAdapterByKey(widgetKey: string, projectDir?: string): AdapterJson | null {
  const key = String(widgetKey || '').trim()
  if (!key) return null
  return widgetAdapters(projectDir).find((adapter) => adapter.widget?.keys?.includes(key)) ?? null
}

export function resolveWidgetAdapterByTool(toolName: string, projectDir?: string): AdapterJson | null {
  const name = String(toolName || '').trim()
  if (!name) return null
  return (
    widgetAdapters(projectDir).find(
      (adapter) => adapter.widget?.tools?.includes(name) || adapter.match?.tools?.includes(name),
    ) ?? null
  )
}

export function normalizeTodoWidgetItems(
  payload: unknown,
  widget?: AdapterWidgetDef,
): TodoWidgetItem[] | null {
  const fields: TodoFieldMap = widget?.fields || {}
  return extractTodoItems(payload, fields)
}
