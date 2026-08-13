import { cpSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'fs'
import { basename, dirname, join } from 'path'
import { canonicalSkillPath } from '@shared/skill-catalog'
import { replaceSkillDescription } from '@shared/skill-description-edit'
import { buildWorkerSkillCatalog, type RuntimeSkill, type WorkerSkillCatalog } from './skill-catalog-runtime.js'
import { getSkillBaseSnapshot } from './skill-override.js'
import { isWslWorker, workerDistro } from './worker-path-bridge.js'
import { st } from './worker-runtime.js'
import { readWorkerSkillOverrides, writeWorkerSkillOverrides } from './worker-skill-settings.js'

type SourceInfo = NonNullable<RuntimeSkill['sourceInfo']>
type LoaderInternals = {
  getSkills?: () => { skills?: RuntimeSkill[]; diagnostics?: Array<Record<string, unknown>> }
  findSourceInfoForPath?: (
    path: string,
    extensionInfos?: Map<string, SourceInfo>,
    metadata?: Map<string, unknown>,
  ) => SourceInfo | undefined
  getDefaultSourceInfoForPath?: (path: string) => SourceInfo
  extensionSkillSourceInfos?: Map<string, SourceInfo>
  resourceMetadataByPath?: Map<string, unknown>
}

function runtimeId(): string {
  return isWslWorker() ? `wsl:${workerDistro}` : 'host'
}

function loader(): LoaderInternals | null {
  return (st.session?.resourceLoader as unknown as LoaderInternals | undefined) ?? null
}

function sourceInfoForPath(path: string, fallback?: SourceInfo): SourceInfo | undefined {
  const resourceLoader = loader()
  if (!resourceLoader) return fallback
  return resourceLoader.findSourceInfoForPath?.call(
    resourceLoader,
    path,
    resourceLoader.extensionSkillSourceInfos,
    resourceLoader.resourceMetadataByPath,
  ) ?? fallback ?? resourceLoader.getDefaultSourceInfoForPath?.call(resourceLoader, path)
}

function loadSkill(path: string): RuntimeSkill | null {
  if (!st.sdk) return null
  const result = st.sdk.loadSkills({
    cwd: st.currentCwd || process.cwd(),
    agentDir: st.sdk.getAgentDir(),
    skillPaths: [path],
    includeDefaults: false,
  })
  const wanted = canonicalSkillPath(path)
  const skill = result.skills.find((row) => canonicalSkillPath(row.filePath) === wanted)
  if (!skill) return null
  return { ...skill, sourceInfo: sourceInfoForPath(skill.filePath, skill.sourceInfo) }
}

export function getLiveWorkerSkillCatalog(): WorkerSkillCatalog {
  const snapshot = getSkillBaseSnapshot()
  const current = loader()?.getSkills?.()
  if (!snapshot || !current) {
    return { complete: false, projectTrusted: false, effectiveSkills: [], candidates: [] }
  }
  const baseSkills = snapshot.skills
    .map((row) => {
      const filePath = String(row.filePath || row.path || '')
      if (!filePath) return null
      const loaded = loadSkill(filePath)
      return loaded || {
        name: String(row.name || basename(dirname(filePath)) || 'skill'),
        description: String(row.description || ''),
        filePath,
        baseDir: row.baseDir,
        sourceInfo: sourceInfoForPath(filePath, row.sourceInfo as SourceInfo | undefined),
      }
    })
    .filter((row): row is RuntimeSkill => row !== null)
  const currentSkills = (current.skills || []).map((skill) => ({
    ...skill,
    sourceInfo: sourceInfoForPath(skill.filePath, skill.sourceInfo),
  }))
  return buildWorkerSkillCatalog({
    runtimeId: runtimeId(),
    currentSkills,
    baseSkills,
    diagnostics: snapshot.diagnostics as never,
    overrides: readWorkerSkillOverrides(),
    projectTrusted: st.session?.settingsManager?.isProjectTrusted?.() ?? true,
    loadSkill,
  })
}

function authorizedCandidate(key: string) {
  const catalog = getLiveWorkerSkillCatalog()
  if (!catalog.complete) throw new Error('SKILL_CATALOG_INCOMPLETE')
  const candidate = catalog.candidates.find((row) => row.key === key)
  if (!candidate) throw new Error('SKILL_NOT_FOUND')
  return { catalog, candidate }
}

export function applySkillOverrideChanges(changes: Array<{ key: string; enabled: boolean }>): number {
  const resolved = changes.map((change) => {
    const { candidate } = authorizedCandidate(change.key)
    if (candidate.shadowed) throw new Error('SHADOWED_SKILL_CANNOT_BE_TOGGLED')
    return { filePath: candidate.nativeFilePath, enabled: change.enabled }
  })
  writeWorkerSkillOverrides(resolved)
  return resolved.length
}

export function writeSkillDescription(key: string, description: string): string {
  const { candidate } = authorizedCandidate(key)
  if (!candidate.editable) throw new Error('SKILL_READ_ONLY')
  const current = readFileSync(candidate.nativeFilePath, 'utf-8')
  const replaced = replaceSkillDescription(current, description)
  if (!replaced.ok) throw new Error(`SKILL_DESCRIPTION_${replaced.reason.toUpperCase().replace(/-/g, '_')}`)
  writeFileSync(candidate.nativeFilePath, replaced.content, 'utf-8')
  return description.trim()
}

export function transferSkill(key: string, target: 'user' | 'project', mode: 'copy' | 'move') {
  const { catalog, candidate } = authorizedCandidate(key)
  if (target === 'project' && !catalog.projectTrusted) throw new Error('PROJECT_NOT_TRUSTED')
  if (mode === 'move' && !candidate.movable) throw new Error('SKILL_READ_ONLY')
  const destRoot = target === 'user'
    ? join(st.sdk!.getAgentDir(), 'skills')
    : join(st.currentCwd, '.pi', 'skills')
  const sourceFile = candidate.nativeFilePath
  const sourceDir = dirname(sourceFile)
  const directorySkill = basename(sourceFile).toLowerCase() === 'skill.md'
  const dest = directorySkill
    ? join(destRoot, basename(sourceDir))
    : join(destRoot, basename(sourceFile))
  if (!existsSync(sourceFile)) throw new Error('SKILL_SOURCE_MISSING')
  if (existsSync(dest)) throw new Error('SKILL_TARGET_EXISTS')
  mkdirSync(destRoot, { recursive: true })
  const temp = `${dest}.tmp-${process.pid}`
  try {
    cpSync(directorySkill ? sourceDir : sourceFile, temp, { recursive: directorySkill })
    renameSync(temp, dest)
    if (mode === 'move') rmSync(directorySkill ? sourceDir : sourceFile, { recursive: directorySkill, force: true })
    return { ok: true, target, name: candidate.name }
  } catch (error) {
    rmSync(temp, { recursive: true, force: true })
    throw error
  }
}
