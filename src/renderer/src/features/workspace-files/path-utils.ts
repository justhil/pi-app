export function joinWorkspacePath(root: string, rel: string): string {
  const sep = root.includes('\\') ? '\\' : '/'
  const r = root.replace(/[/\\]+$/, '')
  const p = rel.replace(/^[/\\]+/, '').split('/').join(sep)
  return `${r}${sep}${p}`
}