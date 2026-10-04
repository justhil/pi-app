// browser_* agent tools: the single definition of names, descriptions and parameters.
// The worker registers them from here; Main validates incoming calls against the same schemas.
// Names and parameters follow Playwright MCP so models trained on it need no new vocabulary.

export type JsonSchema = {
  type?: 'object' | 'string' | 'number' | 'integer' | 'boolean' | 'array'
  description?: string
  properties?: Record<string, JsonSchema>
  required?: string[]
  additionalProperties?: boolean
  items?: JsonSchema
  enum?: readonly (string | number)[]
  minimum?: number
  maximum?: number
  maxLength?: number
  minItems?: number
  maxItems?: number
}

export interface BrowserToolDef {
  name: string
  label: string
  description: string
  parameters: JsonSchema
}

const obj = (properties: Record<string, JsonSchema>, required: string[] = []): JsonSchema => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false,
})

// Target syntax (refs and locators) is explained once in the capability prompt, not per tool.
const target: JsonSchema = { type: 'string', maxLength: 2000, description: 'Ref (e12) or locator' }
const str = (maxLength: number, description?: string): JsonSchema => ({ type: 'string', maxLength, ...(description ? { description } : {}) })

export const BROWSER_TOOL_DEFS: readonly BrowserToolDef[] = [
  {
    name: 'browser_navigate',
    label: 'Browser navigate',
    description: 'Open an http(s) URL in the current tab.',
    parameters: obj({ url: str(8192) }, ['url']),
  },
  {
    name: 'browser_navigate_back',
    label: 'Browser back',
    description: 'Go back to the previous page.',
    parameters: obj({}),
  },
  {
    name: 'browser_snapshot',
    label: 'Browser snapshot',
    description:
      'Accessibility snapshot of the current page (YAML). Interactive elements carry [ref=eN] for other tools. Elements covered by an overlay have no ref. Use target to read one region, depth to limit nesting.',
    parameters: obj({ target, depth: { type: 'integer', minimum: 1, maximum: 50 }, boxes: { type: 'boolean', description: 'Add element boxes.' } }),
  },
  {
    name: 'browser_find',
    label: 'Browser find',
    description: 'Find snapshot lines matching text or a regex (with their ancestors). Cheaper than a full snapshot on big pages.',
    parameters: obj({ text: str(500), regex: str(500, 'e.g. /sign ?in/i') }),
  },
  {
    name: 'browser_click',
    label: 'Browser click',
    description: 'Click an element with real mouse input.',
    parameters: obj(
      {
        target,
        doubleClick: { type: 'boolean' },
        button: { type: 'string', enum: ['left', 'right', 'middle'] },
        modifiers: { type: 'array', maxItems: 4, items: { type: 'string', enum: ['Alt', 'Control', 'ControlOrMeta', 'Meta', 'Shift'] } },
      },
      ['target'],
    ),
  },
  {
    name: 'browser_hover',
    label: 'Browser hover',
    description: 'Move the mouse over an element.',
    parameters: obj({ target }, ['target']),
  },
  {
    name: 'browser_drag',
    label: 'Browser drag',
    description: 'Drag one element onto another.',
    parameters: obj({ startTarget: target, endTarget: target }, ['startTarget', 'endTarget']),
  },
  {
    name: 'browser_type',
    label: 'Browser type',
    description: 'Type into a text field or rich editor. Replaces its content unless slowly=true (appends key by key). submit presses Enter after.',
    parameters: obj({ target, text: str(20000), submit: { type: 'boolean' }, slowly: { type: 'boolean' } }, ['target', 'text']),
  },
  {
    name: 'browser_fill_form',
    label: 'Browser fill form',
    description: 'Fill several fields at once. checkbox/radio take "true"/"false"; combobox takes the option label.',
    parameters: obj(
      {
        fields: {
          type: 'array',
          minItems: 1,
          maxItems: 30,
          items: obj(
            {
              target,
              name: str(200, 'Field name shown to the user.'),
              type: { type: 'string', enum: ['textbox', 'checkbox', 'radio', 'combobox', 'slider'] },
              value: str(20000),
            },
            ['target', 'type', 'value'],
          ),
        },
      },
      ['fields'],
    ),
  },
  {
    name: 'browser_select_option',
    label: 'Browser select',
    description: 'Choose options in a <select> by value or label.',
    parameters: obj({ target, values: { type: 'array', minItems: 1, maxItems: 50, items: str(500) } }, ['target', 'values']),
  },
  {
    name: 'browser_press_key',
    label: 'Browser press key',
    description: 'Press a key or chord on the focused element, e.g. Enter, ArrowDown, Control+A.',
    parameters: obj({ key: str(40) }, ['key']),
  },
  {
    name: 'browser_mouse_wheel',
    label: 'Browser scroll',
    description: 'Scroll with the mouse wheel (positive deltaY = down), over target if given.',
    parameters: obj({ deltaY: { type: 'number', minimum: -20000, maximum: 20000 }, deltaX: { type: 'number', minimum: -20000, maximum: 20000 }, target }, ['deltaY']),
  },
  {
    name: 'browser_file_upload',
    label: 'Browser upload',
    description: 'Set files on a file input without opening a file dialog. Paths must be inside the workspace.',
    parameters: obj({ target, paths: { type: 'array', minItems: 1, maxItems: 10, items: str(4096) } }, ['target', 'paths']),
  },
  {
    name: 'browser_take_screenshot',
    label: 'Browser screenshot',
    description: 'PNG of the viewport, or of one element with target. For visual checks a snapshot cannot show.',
    parameters: obj({ target, fullPage: { type: 'boolean' } }),
  },
  {
    name: 'browser_tabs',
    label: 'Browser tabs',
    description: 'List, open, close or select tabs of this conversation. Other tools act on the selected tab.',
    parameters: obj({ action: { type: 'string', enum: ['list', 'new', 'close', 'select'] }, index: { type: 'integer', minimum: 0, maximum: 99 }, url: str(8192) }, ['action']),
  },
  {
    name: 'browser_wait_for',
    label: 'Browser wait',
    description: 'Wait for text to appear, text to disappear, or a number of seconds (max 30).',
    parameters: obj({ text: str(500), textGone: str(500), time: { type: 'number', minimum: 0, maximum: 30 } }),
  },
  {
    name: 'browser_console_messages',
    label: 'Browser console',
    description: 'Console errors and warnings of the current page.',
    parameters: obj({ onlyErrors: { type: 'boolean' } }),
  },
  {
    name: 'browser_network_requests',
    label: 'Browser network',
    description: 'Failed requests and responses with status >= 400 on the current page.',
    parameters: obj({}),
  },
  {
    name: 'browser_evaluate',
    label: 'Browser evaluate',
    description: 'Run a JS function in an isolated world (DOM access, no page variables). With target, the element is its argument. Returns JSON.',
    parameters: obj({ function: str(20000, 'e.g. "(el) => el.textContent"'), target }, ['function']),
  },
  {
    name: 'browser_handle_dialog',
    label: 'Browser dialog',
    description: 'Accept or dismiss an alert/confirm/prompt that blocks the page.',
    parameters: obj({ accept: { type: 'boolean' }, promptText: str(2000) }, ['accept']),
  },
  {
    name: 'browser_pdf_save',
    label: 'Browser save PDF',
    description: 'Save the current page as PDF and return its path.',
    parameters: obj({ filename: str(200) }),
  },
]

/**
 * The schema the model sees: limits that only Main enforces (lengths, item counts,
 * additionalProperties) are dropped — they cost tokens on every request and the model
 * never needs them. Main validates calls against the full schema.
 */
export function leanSchema(schema: JsonSchema): JsonSchema {
  const { maxLength: _ml, maxItems: _mx, minItems: _mn, additionalProperties: _ap, properties, items, ...rest } = schema
  const out: JsonSchema = { ...rest }
  if (properties) out.properties = Object.fromEntries(Object.entries(properties).map(([k, v]) => [k, leanSchema(v)]))
  if (items) out.items = leanSchema(items)
  if (out.required && out.required.length === 0) delete out.required
  return out
}

export const BROWSER_TOOL_NAMES: readonly string[] = BROWSER_TOOL_DEFS.map((d) => d.name)

const typeOf = (v: unknown) => (Array.isArray(v) ? 'array' : v === null ? 'null' : typeof v)

/**
 * Minimal JSON Schema check for the subset used above. Returns problems as "path: message";
 * empty when valid. Main runs it even though pi validated already (defence in depth).
 */
export function checkArgs(schema: JsonSchema, value: unknown, path = ''): string[] {
  const at = path || 'args'
  const problems: string[] = []
  switch (schema.type) {
    case 'object': {
      if (typeOf(value) !== 'object') return [`${at}: expected an object`]
      const rec = value as Record<string, unknown>
      for (const key of schema.required ?? []) if (rec[key] === undefined) problems.push(`${path ? `${path}.` : ''}${key}: required`)
      for (const [key, v] of Object.entries(rec)) {
        const sub = schema.properties?.[key]
        if (!sub) {
          if (schema.additionalProperties === false) problems.push(`${path ? `${path}.` : ''}${key}: unknown parameter`)
          continue
        }
        if (v !== undefined) problems.push(...checkArgs(sub, v, path ? `${path}.${key}` : key))
      }
      return problems
    }
    case 'array': {
      if (!Array.isArray(value)) return [`${at}: expected an array`]
      if (schema.minItems !== undefined && value.length < schema.minItems) problems.push(`${at}: needs at least ${schema.minItems} item(s)`)
      if (schema.maxItems !== undefined && value.length > schema.maxItems) problems.push(`${at}: at most ${schema.maxItems} items`)
      if (schema.items) value.forEach((v, i) => problems.push(...checkArgs(schema.items!, v, `${at}[${i}]`)))
      return problems
    }
    case 'string':
      if (typeof value !== 'string') return [`${at}: expected a string`]
      if (schema.maxLength !== undefined && value.length > schema.maxLength) problems.push(`${at}: longer than ${schema.maxLength}`)
      break
    case 'integer':
    case 'number':
      if (typeof value !== 'number' || !Number.isFinite(value)) return [`${at}: expected a number`]
      if (schema.type === 'integer' && !Number.isInteger(value)) problems.push(`${at}: expected an integer`)
      if (schema.minimum !== undefined && value < schema.minimum) problems.push(`${at}: below ${schema.minimum}`)
      if (schema.maximum !== undefined && value > schema.maximum) problems.push(`${at}: above ${schema.maximum}`)
      break
    case 'boolean':
      if (typeof value !== 'boolean') return [`${at}: expected true or false`]
      break
  }
  if (schema.enum && !schema.enum.includes(value as string | number)) problems.push(`${at}: one of ${schema.enum.join(', ')}`)
  return problems
}
