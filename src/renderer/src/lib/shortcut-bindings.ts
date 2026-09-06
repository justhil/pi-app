const KEY = 'pi-desktop:shortcut-bindings'

export type ShortcutId = 'commandPalette' | 'shortcuts' | 'completionNotification'

export type ShortcutBinding = {
  key: string
  ctrl: boolean
  meta: boolean
  shift: boolean
  alt: boolean
}

const DEFAULTS: Record<ShortcutId, ShortcutBinding> = {
  commandPalette: { key: 'k', ctrl: true, meta: true, shift: false, alt: false },
  shortcuts: { key: '/', ctrl: true, meta: true, shift: false, alt: false },
  completionNotification: { key: 'n', ctrl: true, meta: true, shift: true, alt: false },
}

export function defaultShortcutBindings(): Record<ShortcutId, ShortcutBinding> {
  return { ...DEFAULTS }
}

export function readShortcutBindings(): Record<ShortcutId, ShortcutBinding> {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '{}') as Partial<Record<ShortcutId, ShortcutBinding>>
    return {
      commandPalette: raw.commandPalette || DEFAULTS.commandPalette,
      shortcuts: raw.shortcuts || DEFAULTS.shortcuts,
      completionNotification: raw.completionNotification || DEFAULTS.completionNotification,
    }
  } catch {
    return defaultShortcutBindings()
  }
}

export function writeShortcutBindings(next: Record<ShortcutId, ShortcutBinding>): void {
  localStorage.setItem(KEY, JSON.stringify(next))
}

export function matchShortcut(event: KeyboardEvent, binding: ShortcutBinding): boolean {
  const key = event.key.toLowerCase()
  if (key !== binding.key.toLowerCase()) return false
  if (event.altKey !== binding.alt) return false
  if (event.shiftKey !== binding.shift) return false
  const mod = event.ctrlKey || event.metaKey
  if (binding.ctrl || binding.meta) return mod
  return !mod
}

export function formatShortcut(binding: ShortcutBinding): string {
  const mac = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform)
  const parts: string[] = []
  if (binding.ctrl || binding.meta) parts.push(mac ? '⌘' : 'Ctrl')
  if (binding.shift) parts.push(mac ? '⇧' : 'Shift')
  if (binding.alt) parts.push(mac ? '⌥' : 'Alt')
  parts.push(binding.key.length === 1 ? binding.key.toUpperCase() : binding.key)
  return parts.join(mac ? '' : '+')
}
