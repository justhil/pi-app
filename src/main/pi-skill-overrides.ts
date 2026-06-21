import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import { skillStorageKey } from './pi-resources-editor'

const GLOBAL_SETTINGS = join(homedir(), '.pi', 'agent', 'settings.json')

export type DesktopSkillOverrides = Record<string, boolean>

export function readGlobalSettingsJson(): Record<string, unknown> {
  if (!existsSync(GLOBAL_SETTINGS)) return {}
  try {
    return JSON.parse(readFileSync(GLOBAL_SETTINGS, 'utf-8'))
  } catch {
    return {}
  }
}

export function getDesktopSkillOverrides(): DesktopSkillOverrides {
  const raw = readGlobalSettingsJson().desktopSkillOverrides
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const out: DesktopSkillOverrides = {}
  for (const [k, v] of Object.entries(raw)) {
    if (v === false) out[k] = false
    if (v === true) out[k] = true
  }
  return out
}

/** 未写入或 true → 启用；仅 false 为禁用 */
export function isSkillEnabled(name: string, path: string | undefined, overrides: DesktopSkillOverrides): boolean {
  const candidates = new Set<string>()
  candidates.add(skillStorageKey(name, path))
  candidates.add(skillStorageKey(name))
  if (path) {
    candidates.add(skillStorageKey(name, path.replace(/\\/g, '/')))
  }
  for (const k of candidates) {
    if (overrides[k] === false) return false
  }
  return true
}

export function setSkillEnabledInGlobal(name: string, path: string | undefined, enabled: boolean): DesktopSkillOverrides {
  const key = skillStorageKey(name, path || undefined)
  const settings = readGlobalSettingsJson()
  const overrides: DesktopSkillOverrides = { ...getDesktopSkillOverrides() }
  if (enabled) {
    delete overrides[key]
    delete overrides[skillStorageKey(name)]
  } else {
    overrides[key] = false
  }
  settings.desktopSkillOverrides = overrides
  const dir = join(homedir(), '.pi', 'agent')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(GLOBAL_SETTINGS, JSON.stringify(settings, null, 2), 'utf-8')
  return overrides
}

/** 批量写入 desktopSkillOverrides，只落盘一次 */
export function applySkillOverridesBatch(
  changes: Array<{ name: string; path?: string; enabled: boolean }>,
): DesktopSkillOverrides {
  if (changes.length === 0) return getDesktopSkillOverrides()
  const settings = readGlobalSettingsJson()
  const overrides: DesktopSkillOverrides = { ...getDesktopSkillOverrides() }
  for (const { name, path, enabled } of changes) {
    const key = skillStorageKey(name, path || undefined)
    if (enabled) {
      delete overrides[key]
      delete overrides[skillStorageKey(name)]
    } else {
      overrides[key] = false
    }
  }
  settings.desktopSkillOverrides = overrides
  const dir = join(homedir(), '.pi', 'agent')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(GLOBAL_SETTINGS, JSON.stringify(settings, null, 2), 'utf-8')
  return overrides
}

/** 一次性：把旧版 electron-store skillOverrides 迁到全局 settings */
export function migrateElectronSkillOverrides(
  legacy: Record<string, boolean> | undefined,
): DesktopSkillOverrides {
  if (!legacy || Object.keys(legacy).length === 0) return getDesktopSkillOverrides()
  const current = getDesktopSkillOverrides()
  const merged = { ...current }
  for (const [k, v] of Object.entries(legacy)) {
    if (v === false) merged[k] = false
  }
  const settings = readGlobalSettingsJson()
  settings.desktopSkillOverrides = merged
  const dir = join(homedir(), '.pi', 'agent')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(GLOBAL_SETTINGS, JSON.stringify(settings, null, 2), 'utf-8')
  return merged
}