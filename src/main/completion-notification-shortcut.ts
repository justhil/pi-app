export type CompletionShortcutInput = {
  type: string
  key: string
  control: boolean
  meta: boolean
  shift: boolean
  alt: boolean
}

export function isCompletionNotificationShortcut(input: CompletionShortcutInput): boolean {
  return input.type === 'keyDown'
    && input.key.toLowerCase() === 'n'
    && (input.control || input.meta)
    && input.shift
    && !input.alt
}
