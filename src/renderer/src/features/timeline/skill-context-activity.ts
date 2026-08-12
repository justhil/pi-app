import type { ToolCallDetail } from '@shared/tool-call-detail'

export interface SkillContextActivity {
  name: string
  path: string
}

function pathFromArgs(args: unknown): string {
  if (!args) return ''
  const parsed = typeof args === 'string'
    ? (() => {
      try {
        return JSON.parse(args) as unknown
      } catch {
        return null
      }
    })()
    : args
  if (!parsed || typeof parsed !== 'object') return ''
  const record = parsed as Record<string, unknown>
  for (const key of ['path', 'file_path', 'fileName', 'file_name']) {
    if (typeof record[key] === 'string') return record[key]
  }
  return ''
}

export function resolveSkillContextActivity(
  toolName: string,
  args: unknown,
  detail?: ToolCallDetail,
): SkillContextActivity | null {
  if (toolName.toLowerCase() !== 'read') return null
  const path = detail?.type === 'read' ? detail.path : pathFromArgs(args)
  if (!/(?:^|[\\/])SKILL\.md$/i.test(path)) return null
  const parts = path.split(/[\\/]+/).filter(Boolean)
  return {
    name: parts.at(-2) || 'Skill',
    path,
  }
}
