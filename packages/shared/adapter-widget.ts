import type { TodoWidgetItem } from './todo-list'

export type AdapterWidgetProtocol = 'todo-list-v1'

export type TodoListWidgetPayload = {
  items: TodoWidgetItem[]
}

export type AdapterWidgetProjection = {
  adapterId: string
  widgetKey: string
  protocol: AdapterWidgetProtocol
  title: string
  icon?: string
  payload: TodoListWidgetPayload
  updatedAt: number
}

export function isTodoListWidgetProjection(
  value: AdapterWidgetProjection,
): value is AdapterWidgetProjection & { protocol: 'todo-list-v1'; payload: TodoListWidgetPayload } {
  return value.protocol === 'todo-list-v1' && Array.isArray(value.payload?.items)
}
