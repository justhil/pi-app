/**
 * Pi extension commands use invocationName (e.g. "goal"). TUI allows concatenated
 * forms like `/goal继续任务` or `/goal1233` (no space). AgentSession only splits
 * on the first space, so we expand to `/goal <rest>` before prompt().
 */
export function stripSlashInvocationPrefix(name: string): string {
  return name.startsWith('/') ? name.slice(1) : name
}

export function expandConcatenatedSlashLine(
  line: string,
  invocationNames: string[],
): { normalized: string; changed: boolean; invocation?: string } {
  const trimmed = line.trim()
  if (!trimmed.startsWith('/')) return { normalized: trimmed, changed: false }
  const body = trimmed.slice(1)
  if (body.includes(' ')) return { normalized: trimmed, changed: false }

  const invs = [...new Set(invocationNames.map(stripSlashInvocationPrefix).filter(Boolean))]
    .sort((a, b) => b.length - a.length)

  for (const inv of invs) {
    if (body === inv) {
      return { normalized: `/${inv}`, changed: false, invocation: inv }
    }
    if (body.startsWith(inv)) {
      const rest = body.slice(inv.length)
      if (rest.length > 0) {
        return { normalized: `/${inv} ${rest}`, changed: true, invocation: inv }
      }
    }
  }
  return { normalized: trimmed, changed: false }
}