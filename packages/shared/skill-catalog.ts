export type SkillScope = 'user' | 'project' | 'temporary'
export type SkillOrigin = 'package' | 'top-level'

export type SkillIdentity = {
  runtimeId: string
  name: string
  filePath: string
  source: string
  scope: SkillScope
  origin: SkillOrigin
  baseDir?: string
}

export type SkillCandidate = SkillIdentity & {
  key: string
  description: string
  enabled: boolean
  effective: boolean
  shadowed: boolean
  shadowedBy?: string
  command: string
  editable: boolean
  movable: boolean
  canCopyToUser: boolean
  canCopyToProject: boolean
  alias?: string
  icon?: string
  diagnostics: string[]
}

export type SkillCatalogResponse = {
  complete: boolean
  projectTrusted: boolean
  effectiveSkills: SkillIdentity[]
  candidates: SkillCandidate[]
}

export function canonicalSkillPath(filePath: string | undefined): string {
  return String(filePath || '').replace(/\\/g, '/').replace(/\/+$/, '')
}

export function skillCatalogKey(identity: Pick<SkillIdentity, 'runtimeId' | 'filePath' | 'source'>): string {
  return `${identity.runtimeId}|${canonicalSkillPath(identity.filePath)}|${identity.source || ''}`
}

export function isSkillPathEnabled(filePath: string | undefined, overrides: Record<string, boolean>): boolean {
  const path = canonicalSkillPath(filePath)
  if (!path) return true
  if (overrides[`path:${path}`] === false) return false
  if (overrides[`path:${filePath}`] === false) return false
  return true
}

export function filterSkillsByEnabledPaths<T extends { filePath?: string; path?: string }>(
  skills: T[],
  overrides: Record<string, boolean>,
): T[] {
  return skills.filter((skill) => isSkillPathEnabled(skill.filePath || skill.path, overrides))
}

export const SKILL_ICON_KEYS = ['list', 'book-open', 'sparkles', 'terminal', 'wrench', 'boxes'] as const
export type SkillIconKey = (typeof SKILL_ICON_KEYS)[number]

export function isSkillIconKey(raw: unknown): raw is SkillIconKey {
  return typeof raw === 'string' && (SKILL_ICON_KEYS as readonly string[]).includes(raw)
}
