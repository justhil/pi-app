import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { skillStorageKey } from './pi-resources-editor'
import { resolveActiveAgentDir, resolveActiveAgentSettingsFile } from './agent-dir'
import { getAgentRuntimeConfig } from './wsl/runtime-config'
import { wslPathToWindows } from '@shared/wsl-path'

function globalSettingsFile(): string {
  return resolveActiveAgentSettingsFile()
}

/**
 * 把 WSL worker 返回的发行版内 Linux 路径（如 `/home/u/proj/.pi/skills/foo/SKILL.md`）
 * 归一化为主进程侧可读的 Windows 视图路径（`\\wsl.localhost\<distro>\...`），
 * 使 worker 行与磁盘扫描行共用同一 overrides key。宿主模式原样返回。
 *
 * 仅转换真正的 Linux 绝对路径（`/` 开头）：协议路径（`pi-desktop://...`）、
 * 相对路径、Windows 视图路径（UNC / 盘符）都保持原样，避免误转换。
 */
export function normalizeSkillPath(path: string | undefined): string | undefined {
  if (!path) return path
  const { mode, distro } = getAgentRuntimeConfig()
  if (mode !== 'wsl') return path
  if (!path.startsWith('/')) return path
  return wslPathToWindows(distro, path)
}

export type DesktopSkillOverrides = Record<string, boolean>

export function readGlobalSettingsJson(): Record<string, unknown> {
  if (!existsSync(globalSettingsFile())) return {}
  try {
    return JSON.parse(readFileSync(globalSettingsFile(), 'utf-8'))
  } catch (e) {
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
  const normalizedPath = normalizeSkillPath(path)
  const candidates = new Set<string>()
  candidates.add(skillStorageKey(name, normalizedPath))
  candidates.add(skillStorageKey(name))
  if (normalizedPath) {
    candidates.add(skillStorageKey(name, normalizedPath.replace(/\\/g, '/')))
  }
  for (const k of candidates) {
    if (overrides[k] === false) return false
  }
  return true
}

export function setSkillEnabledInGlobal(name: string, path: string | undefined, enabled: boolean): DesktopSkillOverrides {
  const normalizedPath = normalizeSkillPath(path)
  const key = skillStorageKey(name, normalizedPath || undefined)
  const settings = readGlobalSettingsJson()
  const overrides: DesktopSkillOverrides = { ...getDesktopSkillOverrides() }
  if (enabled) {
    delete overrides[key]
    delete overrides[skillStorageKey(name)]
  } else {
    overrides[key] = false
  }
  settings.desktopSkillOverrides = overrides
  const dir = resolveActiveAgentDir()
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(globalSettingsFile(), JSON.stringify(settings, null, 2), 'utf-8')
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
    const normalizedPath = normalizeSkillPath(path)
    const key = skillStorageKey(name, normalizedPath || undefined)
    if (enabled) {
      delete overrides[key]
      delete overrides[skillStorageKey(name)]
    } else {
      overrides[key] = false
    }
  }
  settings.desktopSkillOverrides = overrides
  const dir = resolveActiveAgentDir()
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(globalSettingsFile(), JSON.stringify(settings, null, 2), 'utf-8')
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
  const dir = resolveActiveAgentDir()
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(globalSettingsFile(), JSON.stringify(settings, null, 2), 'utf-8')
  return merged
}