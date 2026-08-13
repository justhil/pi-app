import { filterSkillsByEnabledPaths } from '@shared/skill-catalog'
import { readWorkerSkillOverrides } from './worker-skill-settings.js'

type SkillSnapshot = {
  skills: Array<{ name?: string; description?: string; filePath?: string; path?: string; baseDir?: string; sourceInfo?: unknown }>
  diagnostics: Array<Record<string, unknown>>
}

let baseSnapshot: SkillSnapshot | null = null

export function getSkillBaseSnapshot(): SkillSnapshot | null {
  return baseSnapshot
}

export function resetSkillBaseSnapshot(): void {
  baseSnapshot = null
}

export function desktopSkillOverridesFromSettings(): Record<string, boolean> {
  return readWorkerSkillOverrides()
}

export function applySkillsOverride(base: SkillSnapshot): SkillSnapshot {
  baseSnapshot = {
    skills: [...base.skills],
    diagnostics: [...base.diagnostics],
  }
  return {
    skills: filterSkillsByEnabledPaths(base.skills, desktopSkillOverridesFromSettings()),
    diagnostics: base.diagnostics,
  }
}
