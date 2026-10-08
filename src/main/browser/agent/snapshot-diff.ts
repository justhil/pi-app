// Pure helpers that keep tool results short: what changed after an action, and a compact page
// outline after a navigation. Lines are YAML snapshot lines; refs are stable across snapshots
// (Playwright keeps one ref per element while its role and name hold), so lines compare well.

import { parseYaml, type ShapeNode } from './snapshot-shape'

const MAX_DIFF_LINES = 40

type Entry = { text: string; ancestors: string[] }

function entries(yaml: string): Entry[] {
  const out: Entry[] = []
  const walk = (nodes: ShapeNode[], ancestors: string[]) => {
    for (const n of nodes) {
      out.push({ text: n.text.trim(), ancestors })
      walk(n.children, [...ancestors, n.text.trim()])
    }
  }
  walk(parseYaml(yaml), [])
  return out
}

/**
 * Lines removed from `prev` and added in `next`, count-aware (a line repeated three times and
 * now twice is one removal), grouped under the nearest ancestor both snapshots share so the
 * model sees where on the page the change happened (GenericAgent reports the changed region).
 * Returns null when nothing changed.
 */
export function diffSnapshots(prev: string, next: string, maxLines = MAX_DIFF_LINES): string | null {
  const a = entries(prev)
  const b = entries(next)
  const count = (list: Entry[]) => {
    const m = new Map<string, number>()
    for (const e of list) m.set(e.text, (m.get(e.text) ?? 0) + 1)
    return m
  }
  const inA = count(a)
  const inB = count(b)
  const groups = new Map<string, string[]>()
  const take = (list: Entry[], other: Map<string, number>, sign: string) => {
    const budget = new Map(other)
    for (const e of list) {
      const left = budget.get(e.text) ?? 0
      if (left > 0) {
        budget.set(e.text, left - 1)
        continue
      }
      const anchor = [...e.ancestors].reverse().find((t) => other.has(t)) ?? ''
      const lines = groups.get(anchor) ?? []
      lines.push(`${sign} ${e.text.replace(/^- /, '')}`)
      groups.set(anchor, lines)
    }
  }
  take(a, inB, '-')
  take(b, inA, '+')
  if (groups.size === 0) return null
  const all: string[] = []
  for (const [anchor, lines] of groups) {
    if (anchor) all.push(`in ${anchor.replace(/^- /, '').replace(/:$/, '')}:`, ...lines.map((l) => `  ${l}`))
    else all.push(...lines)
  }
  if (all.length <= maxLines) return all.join('\n')
  return `${all.slice(0, maxLines).join('\n')}\n… ${all.length - maxLines} more changed lines; call browser_snapshot for the full page`
}

const KEEP_ROLES = new Set(['heading', 'button', 'link', 'textbox', 'searchbox', 'checkbox', 'radio', 'combobox', 'listbox', 'option', 'slider', 'spinbutton', 'switch', 'tab', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'treeitem', 'dialog', 'alert'])

/**
 * After a navigation a diff is meaningless: give headings and the elements an agent acts on
 * (by role, or anything rendered with a pointer cursor) plus fold summaries, keeping indentation,
 * capped at `maxChars`.
 */
export function compactSnapshot(yaml: string, maxChars = 6000): string {
  const keep = yaml.split('\n').filter((l) => KEEP_ROLES.has(/^\s*- (\w+)/.exec(l)?.[1] ?? '') || /\[cursor=pointer\]/.test(l) || /^\s*- … /.test(l))
  let out = ''
  for (const line of keep) {
    if (out.length + line.length + 1 > maxChars) return `${out}… (more; browser_snapshot target=<ref> or query="…")`
    out += `${line}\n`
  }
  return out.trimEnd()
}
