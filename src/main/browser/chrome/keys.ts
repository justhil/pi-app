// Key specs (`Enter`, `ArrowDown`, `Control+A`) → CDP Input.dispatchKeyEvent fields.

export interface CdpKey {
  key: string
  code: string
  keyCode: number
  text?: string
  /** CDP bitmask: Alt 1, Control 2, Meta 4, Shift 8. */
  modifiers: number
}

const NAMED: Record<string, { key: string; code: string; keyCode: number; text?: string }> = {
  enter: { key: 'Enter', code: 'Enter', keyCode: 13, text: '\r' },
  return: { key: 'Enter', code: 'Enter', keyCode: 13, text: '\r' },
  tab: { key: 'Tab', code: 'Tab', keyCode: 9 },
  backspace: { key: 'Backspace', code: 'Backspace', keyCode: 8 },
  escape: { key: 'Escape', code: 'Escape', keyCode: 27 },
  esc: { key: 'Escape', code: 'Escape', keyCode: 27 },
  delete: { key: 'Delete', code: 'Delete', keyCode: 46 },
  insert: { key: 'Insert', code: 'Insert', keyCode: 45 },
  space: { key: ' ', code: 'Space', keyCode: 32, text: ' ' },
  ' ': { key: ' ', code: 'Space', keyCode: 32, text: ' ' },
  arrowup: { key: 'ArrowUp', code: 'ArrowUp', keyCode: 38 },
  arrowdown: { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40 },
  arrowleft: { key: 'ArrowLeft', code: 'ArrowLeft', keyCode: 37 },
  arrowright: { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39 },
  home: { key: 'Home', code: 'Home', keyCode: 36 },
  end: { key: 'End', code: 'End', keyCode: 35 },
  pageup: { key: 'PageUp', code: 'PageUp', keyCode: 33 },
  pagedown: { key: 'PageDown', code: 'PageDown', keyCode: 34 },
}
for (let i = 1; i <= 12; i++) NAMED[`f${i}`] = { key: `F${i}`, code: `F${i}`, keyCode: 111 + i }

const PUNCT: Record<string, [string, number]> = {
  '-': ['Minus', 189], '=': ['Equal', 187], '[': ['BracketLeft', 219], ']': ['BracketRight', 221], '\\': ['Backslash', 220],
  ';': ['Semicolon', 186], "'": ['Quote', 222], ',': ['Comma', 188], '.': ['Period', 190], '/': ['Slash', 191], '`': ['Backquote', 192],
}

export function cdpKey(spec: string, platform: NodeJS.Platform = process.platform): CdpKey {
  const parts = spec.split('+').map((p) => p.trim())
  const raw = spec.trim() === '+' || spec.endsWith('++') ? '+' : (parts.pop() ?? '')
  if (spec.endsWith('++')) parts.splice(-1, 1)
  let modifiers = 0
  for (const m of parts.filter(Boolean).map((p) => p.toLowerCase())) {
    if (m === 'alt' || m === 'option') modifiers |= 1
    else if (m === 'control' || m === 'ctrl') modifiers |= 2
    else if (m === 'meta' || m === 'cmd' || m === 'command') modifiers |= 4
    else if (m === 'controlormeta') modifiers |= platform === 'darwin' ? 4 : 2
    else if (m === 'shift') modifiers |= 8
  }
  const named = NAMED[raw.toLowerCase()]
  const chord = (modifiers & 7) !== 0
  if (named) return { ...named, ...(chord ? { text: undefined } : {}), modifiers }
  const ch = raw.length === 1 ? raw : raw.charAt(0)
  let code = ''
  let keyCode = ch.toUpperCase().charCodeAt(0)
  if (/[a-z]/i.test(ch)) code = `Key${ch.toUpperCase()}`
  else if (/[0-9]/.test(ch)) code = `Digit${ch}`
  else if (PUNCT[ch]) [code, keyCode] = PUNCT[ch]
  return { key: ch, code, keyCode, ...(chord ? {} : { text: ch }), modifiers }
}
