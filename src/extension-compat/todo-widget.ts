import { extractTodoItems, type TodoFieldMap, type TodoStatus, type TodoWidgetItem } from '@shared/todo-list'
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
  // An explicit widget.tools list is authoritative: other tools of the same package must not
  // have their results read as todo lists.
  return (
    widgetAdapters(projectDir).find((adapter) =>
      adapter.widget?.tools ? adapter.widget.tools.includes(name) : adapter.match?.tools?.includes(name),
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

function compile(source: string | undefined): RegExp | null {
  if (!source) return null
  try {
    return new RegExp(source)
  } catch {
    return null
  }
}

/**
 * Rows of a widget that only renders text (TUI factory or string list). Without `textLines`
 * every non-empty line is a pending item; with it, headings are skipped and status / id are
 * read from the line's leading marker.
 */
export function todoItemsFromTextLines(lines: readonly unknown[], widgetKey: string, widget?: AdapterWidgetDef): TodoWidgetItem[] {
  const spec = widget?.textLines
  const skip = (spec?.skip ?? []).map(compile).filter((re): re is RegExp => re != null)
  const strip = compile(spec?.strip)
  const idPattern = compile(spec?.id)
  // Longest marker first so one marker cannot shadow another it is a prefix of.
  const markers = Object.entries(spec?.status ?? {}).sort(([a], [b]) => b.length - a.length)
  const items: TodoWidgetItem[] = []
  lines.forEach((line, index) => {
    let text = String(line ?? '').replace(/\x1b\[[0-9;]*m/g, '').trim()
    if (strip) text = text.replace(strip, '').trim()
    if (!text || skip.some((re) => re.test(text))) return
    let status: TodoStatus = 'pending'
    const marker = markers.find(([mark]) => text.startsWith(mark))
    if (marker) {
      status = marker[1]
      text = text.slice(marker[0].length).trim()
    }
    let id = `${widgetKey}-${index}`
    const match = idPattern ? text.match(idPattern) : null
    if (match && match.index === 0 && match[1]) {
      id = match[1]
      text = text.slice(match[0].length).trim()
    }
    if (text) items.push({ id, text, status })
  })
  return items
}
