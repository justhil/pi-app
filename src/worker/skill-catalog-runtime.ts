import {
  canonicalSkillPath,
  isSkillPathEnabled,
  skillCatalogKey,
  type SkillCandidate,
  type SkillCatalogResponse,
  type SkillIdentity,
  type SkillOrigin,
  type SkillScope,
} from '@shared/skill-catalog'

type SourceInfo = {
  path?: string
  source?: string
  scope?: SkillScope
  origin?: SkillOrigin
  baseDir?: string
}

export type RuntimeSkill = {
  name: string
  description?: string
  filePath: string
  baseDir?: string
  sourceInfo?: SourceInfo
}

type ResourceDiagnostic = {
  type: string
  message?: string
  path?: string
  collision?: {
    resourceType: string
    name: string
    winnerPath: string
    loserPath: string
  }
}

export type WorkerSkillCandidate = SkillCandidate & { nativeFilePath: string }
export type WorkerSkillCatalog = Omit<SkillCatalogResponse, 'candidates'> & {
  candidates: WorkerSkillCandidate[]
}

function identity(skill: RuntimeSkill, runtimeId: string): SkillIdentity {
  const info = skill.sourceInfo || {}
  return {
    runtimeId,
    name: skill.name,
    filePath: skill.filePath,
    source: String(info.source || 'unknown'),
    scope: info.scope || 'temporary',
    origin: info.origin || 'top-level',
    baseDir: info.baseDir || skill.baseDir,
  }
}

export function buildWorkerSkillCatalog(opts: {
  runtimeId: string
  currentSkills: RuntimeSkill[]
  baseSkills: RuntimeSkill[]
  diagnostics: ResourceDiagnostic[]
  overrides: Record<string, boolean>
  projectTrusted?: boolean
  loadSkill: (path: string) => RuntimeSkill | null
}): WorkerSkillCatalog {
  const collisionByLoser = new Map<string, NonNullable<ResourceDiagnostic['collision']>>()
  const winnerPathByName = new Map<string, string>()
  for (const skill of opts.baseSkills) winnerPathByName.set(skill.name, canonicalSkillPath(skill.filePath))
  for (const diagnostic of opts.diagnostics) {
    const collision = diagnostic.collision
    if (!collision || collision.resourceType !== 'skill') continue
    collisionByLoser.set(canonicalSkillPath(collision.loserPath), collision)
    winnerPathByName.set(collision.name, canonicalSkillPath(collision.winnerPath))
  }

  const candidatesByPath = new Map<string, RuntimeSkill>()
  for (const skill of opts.baseSkills) {
    candidatesByPath.set(canonicalSkillPath(skill.filePath), opts.loadSkill(skill.filePath) || skill)
  }
  for (const collision of collisionByLoser.values()) {
    const loaded = opts.loadSkill(collision.loserPath)
    if (loaded) candidatesByPath.set(canonicalSkillPath(loaded.filePath), loaded)
  }

  const currentPaths = new Set(opts.currentSkills.map((skill) => canonicalSkillPath(skill.filePath)))
  const candidates: WorkerSkillCandidate[] = []
  const expectedPaths = new Set([
    ...opts.baseSkills.map((skill) => canonicalSkillPath(skill.filePath)),
    ...[...collisionByLoser.values()].map((collision) => canonicalSkillPath(collision.loserPath)),
  ])
  for (const [pathKey, skill] of candidatesByPath) {
    const rowIdentity = identity(skill, opts.runtimeId)
    const collision = collisionByLoser.get(pathKey)
    const winnerPath = winnerPathByName.get(skill.name)
    const shadowed = !!collision || (!!winnerPath && winnerPath !== pathKey)
    const topLevel = rowIdentity.origin === 'top-level' && rowIdentity.scope !== 'temporary'
    candidates.push({
      ...rowIdentity,
      key: skillCatalogKey(rowIdentity),
      nativeFilePath: skill.filePath,
      description: String(skill.description || ''),
      enabled: isSkillPathEnabled(skill.filePath, opts.overrides),
      effective: currentPaths.has(pathKey),
      shadowed,
      command: `/skill:${skill.name}`,
      editable: topLevel,
      movable: topLevel,
      canCopyToUser: rowIdentity.scope !== 'user',
      canCopyToProject: rowIdentity.scope !== 'project',
      diagnostics: opts.diagnostics
        .filter((diagnostic) => canonicalSkillPath(diagnostic.path) === pathKey || diagnostic.collision?.name === skill.name)
        .map((diagnostic) => String(diagnostic.message || diagnostic.type)),
    })
  }

  const keyByPath = new Map(candidates.map((candidate) => [canonicalSkillPath(candidate.filePath), candidate.key]))
  for (const candidate of candidates) {
    if (!candidate.shadowed) continue
    const winnerPath = winnerPathByName.get(candidate.name)
    candidate.shadowedBy = winnerPath ? keyByPath.get(winnerPath) : undefined
  }

  return {
    complete: [...expectedPaths].every((path) => candidatesByPath.has(path)),
    projectTrusted: opts.projectTrusted !== false,
    effectiveSkills: opts.currentSkills.map((skill) => identity(skill, opts.runtimeId)),
    candidates,
  }
}
