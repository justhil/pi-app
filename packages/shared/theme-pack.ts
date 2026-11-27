import type { CustomTheme } from './custom-theme'

export type SavedThemePack = {
  id: string
  name: string
  updatedAt: number
  theme: CustomTheme
  customCss?: string
}

export type SnippetSettingControl =
  | {
      id: string
      title: string
      type: 'color'
      default: string
    }
  | {
      id: string
      title: string
      type: 'number'
      default: number
      min: number
      max: number
      step: number
      unit?: string
    }
  | {
      id: string
      title: string
      type: 'toggle'
      /** Toggles `html.<id>` class when true. */
      default: boolean
    }

export type CssSnippetValues = Record<string, string | number | boolean>

export type CssSnippetItem = {
  id: string
  name: string
  enabled: boolean
  updatedAt: number
  css: string
  controls: SnippetSettingControl[]
  values: CssSnippetValues
}

/**
 * Parses lightweight Obsidian Style Settings-style `/* @settings ... *\/` blocks inside a CSS snippet.
 *
 * Supported item forms (simple indented key/value blocks separated by `-`):
 * ```css
 * /* @settings
 * - id: --my-card-glow
 *   title: Card glow opacity
 *   type: number
 *   default: 0.25
 *   min: 0
 *   max: 1
 *   step: 0.05
 * - id: --my-tint
 *   title: Tint color
 *   type: color
 *   default: #f6833b
 * - id: fx-compact-tabs
 *   title: Compact right tabs
 *   type: toggle
 *   default: true
 * *\/
 * ```
 */
export function parseSnippetStyleSettings(css: string): SnippetSettingControl[] {
  const match = /\/\*\s*@settings\b([\s\S]*?)\*\//.exec(css)
  if (!match) return []
  const body = match[1]
  const rawItems: Record<string, string>[] = []
  let current: Record<string, string> | null = null

  for (const rawLine of body.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    if (line.startsWith('-')) {
      current = {}
      rawItems.push(current)
      const rest = line.slice(1).trim()
      const kv = /^([a-zA-Z0-9_-]+)\s*:\s*(.+)$/.exec(rest)
      if (kv) current[kv[1]] = kv[2].trim().replace(/^['"]|['"]$/g, '')
      continue
    }
    if (current) {
      const kv = /^([a-zA-Z0-9_-]+)\s*:\s*(.+)$/.exec(line)
      if (kv) current[kv[1]] = kv[2].trim().replace(/^['"]|['"]$/g, '')
    }
  }

  const controls: SnippetSettingControl[] = []
  for (const item of rawItems) {
    const id = item.id?.trim()
    const title = item.title?.trim() || id
    const rawType = (item.type || '').toLowerCase()
    if (!id || !title) continue

    if (rawType === 'color' || rawType === 'variable-color') {
      if (!id.startsWith('--')) continue
      const def = /^#[0-9a-f]{3,8}$/i.test(item.default || '') ? item.default! : '#888888'
      controls.push({ id, title, type: 'color', default: def })
    } else if (
      rawType === 'number' ||
      rawType === 'slider' ||
      rawType === 'variable-number' ||
      rawType === 'variable-number-slider'
    ) {
      if (!id.startsWith('--')) continue
      const min = Number.isFinite(Number(item.min)) ? Number(item.min) : 0
      const max = Number.isFinite(Number(item.max)) ? Number(item.max) : 100
      const step = Number.isFinite(Number(item.step)) && Number(item.step) > 0 ? Number(item.step) : 1
      const def = Number.isFinite(Number(item.default)) ? Number(item.default) : min
      const unit = item.unit || item.format || undefined
      controls.push({ id, title, type: 'number', default: def, min, max, step, ...(unit ? { unit } : {}) })
    } else if (rawType === 'toggle' || rawType === 'class-toggle') {
      if (!/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(id)) continue
      controls.push({ id, title, type: 'toggle', default: item.default === 'true' })
    }
  }
  return controls
}

/** Build the runtime CSS + active root classes produced by enabled snippets and their control values. */
export function buildActiveSnippetsPayload(snippets: readonly CssSnippetItem[]): {
  css: string
  classes: string[]
} {
  const cssParts: string[] = []
  const varDecls: string[] = []
  const classes: string[] = []

  for (const snip of snippets) {
    if (!snip.enabled) continue
    if (snip.css.trim()) cssParts.push(`/* snippet: ${snip.name} */\n${snip.css}`)
    for (const ctrl of snip.controls) {
      const val = snip.values[ctrl.id] ?? ctrl.default
      if (ctrl.type === 'color' && typeof val === 'string' && /^#[0-9a-f]{3,8}$/i.test(val)) {
        varDecls.push(`${ctrl.id}: ${val};`)
      } else if (ctrl.type === 'number' && typeof val === 'number' && Number.isFinite(val)) {
        varDecls.push(`${ctrl.id}: ${val}${ctrl.unit ?? ''};`)
      } else if (ctrl.type === 'toggle' && val === true) {
        classes.push(ctrl.id)
      }
    }
  }

  if (varDecls.length > 0) {
    cssParts.push(`:root {\n  ${varDecls.join('\n  ')}\n}`)
  }
  return { css: cssParts.join('\n\n'), classes }
}
