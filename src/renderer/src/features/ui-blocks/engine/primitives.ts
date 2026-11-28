const UI_CONTAINER_PRIMITIVES = ['panel', 'row', 'stack', 'grid', 'card', 'tabs', 'collapse'] as const

const UI_LEAF_PRIMITIVES = [
  'divider',
  'text',
  'stat',
  'badge',
  'progress',
  'callout',
  'formula',
  'scene',
  'slider',
  'select',
  'segmented',
  'switch',
  'input',
  'button',
] as const

export type UIPrimitive = (typeof UI_CONTAINER_PRIMITIVES)[number] | (typeof UI_LEAF_PRIMITIVES)[number]

export const UI_PRIMITIVES: readonly UIPrimitive[] = [...UI_CONTAINER_PRIMITIVES, ...UI_LEAF_PRIMITIVES]

const PRIMITIVE_SET: ReadonlySet<string> = new Set(UI_PRIMITIVES)
const CONTAINER_SET: ReadonlySet<string> = new Set(UI_CONTAINER_PRIMITIVES)

export function isUIPrimitive(name: string): name is UIPrimitive {
  return PRIMITIVE_SET.has(name)
}

export function isUIContainer(name: string): boolean {
  return CONTAINER_SET.has(name)
}
