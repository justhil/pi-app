/**
 * pi-ui blocks: a fenced code block whose language is `pi-ui` (or `deeix-ui`, for answers written
 * against that convention) and whose body is a JSON envelope `{component, id, props}`. The model
 * only emits it when a skill / prompt taught it the format; in terminal pi it stays readable JSON.
 *
 * This module is deliberately dependency-free: the Markdown renderer imports it on every code
 * block, while the parser and components load lazily on the first block.
 */
export const UI_BLOCK_LANGUAGES = ['pi-ui', 'deeix-ui'] as const

export function uiBlockLanguageFromClassName(className: string | undefined | null): string | null {
  const match = /(?:^|\s)language-([\w-]+)/.exec(className || '')
  const language = match?.[1]?.toLowerCase()
  return language && (UI_BLOCK_LANGUAGES as readonly string[]).includes(language) ? language : null
}

/** Component name, read before the JSON is complete (skeleton choice while streaming). */
export function peekComponentName(raw: string): string | null {
  return /"component"\s*:\s*"([\w-]+)"/.exec(raw)?.[1] ?? null
}

const COLLECTION_KEYS = ['items', 'rows', 'tasks', 'questions', 'nodes', 'series'] as const

/** Rough number of collection entries already streamed, so skeletons reserve the right height. */
export function peekItemCount(raw: string): number {
  for (const key of COLLECTION_KEYS) {
    const at = raw.indexOf(`"${key}"`)
    if (at < 0) continue
    const rest = raw.slice(at)
    return (rest.match(/\{\s*"/g) ?? []).length
  }
  return 0
}
