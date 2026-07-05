export function parseGitStatus(status: string): { path: string; changeType: string; staged: boolean }[] {
  if (!status) return []
  const out: { path: string; changeType: string; staged: boolean }[] = []
  for (const line of status.trim().split('\n').filter(Boolean)) {
    if (line.startsWith('##')) continue
    if (line.length < 4) continue
    const code = line.substring(0, 2)
    const path = line.substring(3).trim()
    if (!path) continue
    const x = code[0]
    const y = code[1]
    let changeType = 'modified'
    if (x === 'A' || x === '?' || y === '?') changeType = 'added'
    else if (x === 'D' || y === 'D') changeType = 'deleted'
    else if (x === 'R' || y === 'R') changeType = 'renamed'
    const staged = x !== ' ' && x !== '?'
    out.push({ path, changeType, staged })
  }
  return out
}