export const TODO_STATUSES = ['pending', 'in_progress', 'completed', 'cancelled'] as const
export type TodoStatus = (typeof TODO_STATUSES)[number]
export type TodoPriority = 'high' | 'medium' | 'low'

export type TodoWidgetItem = {
  id: string
  text: string
  status: TodoStatus
  priority?: TodoPriority
}

export type TodoWidgetState = {
  adapterId: string
  widgetKey: string
  title: string
  items: TodoWidgetItem[]
  updatedAt: number
}

export type TodoFieldMap = {
  items?: string
  id?: string
  text?: string
  status?: string
  done?: string
  priority?: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readPath(source: unknown, path: string | undefined): unknown {
  if (!path) return undefined
  const parts = path.replace(/^\$\.?/, '').split('.').filter(Boolean)
  let cur: unknown = source
  for (const part of parts) {
    if (!isRecord(cur) && !Array.isArray(cur)) return undefined
    cur = (cur as Record<string, unknown>)[part]
  }
  return cur
}

function asStatus(raw: unknown): TodoStatus | null {
  const value = String(raw || '').trim()
  return (TODO_STATUSES as readonly string[]).includes(value) ? (value as TodoStatus) : null
}

function asPriority(raw: unknown): TodoPriority | undefined {
  const value = String(raw || '').trim()
  if (value === 'high' || value === 'medium' || value === 'low') return value
  return undefined
}

function itemFromUnknown(raw: unknown, fields: TodoFieldMap, index: number): TodoWidgetItem | null {
  if (!isRecord(raw)) return null
  const text = String(raw[fields.text || 'text'] ?? raw.content ?? raw.title ?? '').trim()
  if (!text) return null
  const id = String(raw[fields.id || 'id'] ?? `todo-${index + 1}`)
  const doneRaw = raw[fields.done || 'done']
  let status = asStatus(raw[fields.status || 'status'])
  if (!status && typeof doneRaw === 'boolean') status = doneRaw ? 'completed' : 'pending'
  if (!status) return null
  return {
    id,
    text,
    status,
    priority: asPriority(raw[fields.priority || 'priority']),
  }
}

export function extractTodoItems(payload: unknown, fields: TodoFieldMap = {}): TodoWidgetItem[] | null {
  if (payload == null) return null
  const itemsPath = fields.items || 'todos'
  const list =
    Array.isArray(payload)
      ? payload
      : Array.isArray(readPath(payload, itemsPath))
        ? (readPath(payload, itemsPath) as unknown[])
        : Array.isArray((payload as { items?: unknown }).items)
          ? ((payload as { items: unknown[] }).items)
          : null
  if (!list) return null
  const items = list
    .map((row, index) => itemFromUnknown(row, fields, index))
    .filter((row): row is TodoWidgetItem => row != null)
  if (items.length === 0 && list.length > 0) return null
  return items
}

export function todoCounts(items: TodoWidgetItem[]): {
  total: number
  completed: number
  inProgress: number
  pending: number
  cancelled: number
} {
  return {
    total: items.length,
    completed: items.filter((item) => item.status === 'completed').length,
    inProgress: items.filter((item) => item.status === 'in_progress').length,
    pending: items.filter((item) => item.status === 'pending').length,
    cancelled: items.filter((item) => item.status === 'cancelled').length,
  }
}
