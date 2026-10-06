import type { ITheme } from '@xterm/xterm'

/** ANSI 16 colours, tuned per mode for contrast on the app's own background (pebrel-style muted palette). */
const LIGHT = {
  black: '#1f2328', red: '#cf222e', green: '#116329', yellow: '#9a6700', blue: '#0969da', magenta: '#8250df', cyan: '#1b7c83', white: '#6e7781',
  brightBlack: '#57606a', brightRed: '#a40e26', brightGreen: '#1a7f37', brightYellow: '#7d4e00', brightBlue: '#218bff', brightMagenta: '#a475f9', brightCyan: '#3192aa', brightWhite: '#8c959f',
}
const DARK = {
  black: '#484f58', red: '#ff7b72', green: '#3fb950', yellow: '#d29922', blue: '#58a6ff', magenta: '#bc8cff', cyan: '#39c5cf', white: '#b1bac4',
  brightBlack: '#6e7681', brightRed: '#ffa198', brightGreen: '#56d364', brightYellow: '#e3b341', brightBlue: '#79c0ff', brightMagenta: '#d2a8ff', brightCyan: '#56d4dd', brightWhite: '#f0f6fc',
}

const cssVar = (name: string, fallback: string): string => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback

export function isDarkTheme(): boolean {
  return document.documentElement.classList.contains('dark')
}

/** xterm theme from the app tokens, so the terminal sits on the same paper as the chat. */
export function terminalTheme(): ITheme {
  const dark = isDarkTheme()
  const bg = cssVar('--bg-base', dark ? '#1f1f1f' : '#ffffff')
  const fg = cssVar('--text-primary', dark ? '#cccccc' : '#12141a')
  const accent = cssVar('--primary-semantic', dark ? '#4daafc' : '#165dff')
  return {
    background: bg,
    foreground: fg,
    cursor: fg,
    cursorAccent: bg,
    selectionBackground: dark ? 'rgba(77,170,252,0.32)' : 'rgba(22,93,255,0.18)',
    selectionInactiveBackground: dark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.08)',
    scrollbarSliderBackground: dark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.12)',
    scrollbarSliderHoverBackground: dark ? 'rgba(255,255,255,0.22)' : 'rgba(0,0,0,0.22)',
    scrollbarSliderActiveBackground: accent,
    ...(dark ? DARK : LIGHT),
  }
}

export const TERMINAL_FONT = "'Geist Mono', ui-monospace, 'SF Mono', Menlo, Consolas, 'Liberation Mono', monospace"
