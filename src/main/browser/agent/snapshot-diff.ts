// Pure helpers that keep tool results short: what changed after an action, and a compact page
// outline after a navigation. Lines are YAML snapshot lines; refs are stable across snapshots
// (Playwright keeps one ref per element while its role and name hold), so lines compare well.

const MAX_DIFF_LINES = 40

/**
 * Lines removed from `prev` and added in `next`, count-aware (a line repeated three times and
 * now twice is one removal). Order follows each snapshot. Returns null when nothing changed.
 */
export function diffSnapshots(prev: string, next: string, maxLines = MAX_DIFF_LINES): string | null {
  const count = (lines: string[]) => {
    const m = new Map<string, number>()
    for (const l of lines) m.set(l, (m.get(l) ?? 0) + 1)
    return m
  }
  const a = prev.split('\n').map((l) => l.trim()).filter(Boolean)
  const b = next.split('\n').map((l) => l.trim()).filter(Boolean)
  const inA = count(a)
  const inB = count(b)
  const removed: string[] = []
  const added: string[] = []
  const take = (lines: string[], other: Map<string, number>, out: string[], sign: string) => {
    const budget = new Map(other)
    for (const l of lines) {
      const left = budget.get(l) ?? 0
      if (left > 0) budget.set(l, left - 1)
      else out.push(`${sign} ${l.replace(/^- /, '')}`)
    }
  }
  take(a, inB, removed, '-')
  take(b, inA, added, '+')
  const all = [...removed, ...added]
  if (all.length === 0) return null
  if (all.length <= maxLines) return all.join('\n')
  return `${all.slice(0, maxLines).join('\n')}\n… ${all.length - maxLines} more changed lines; call browser_snapshot for the full page`
}

const KEEP_ROLES = new Set(['heading', 'button', 'link', 'textbox', 'searchbox', 'checkbox', 'radio', 'combobox', 'listbox', 'option', 'slider', 'spinbutton', 'switch', 'tab', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'treeitem', 'dialog', 'alert'])

/**
 * After a navigation a diff is meaningless: give headings and the elements an agent acts on
 * (by role, or anything rendered with a pointer cursor), keeping indentation, capped at `maxChars`.
 */
export function compactSnapshot(yaml: string, maxChars = 6000): string {
  const keep = yaml.split('\n').filter((l) => KEEP_ROLES.has(/^\s*- (\w+)/.exec(l)?.[1] ?? '') || /\[cursor=pointer\]/.test(l))
  let out = ''
  for (const line of keep) {
    if (out.length + line.length + 1 > maxChars) return `${out}… (more; call browser_snapshot or browser_find)`
    out += `${line}\n`
  }
  return out.trimEnd()
}
