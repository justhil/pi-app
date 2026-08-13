import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { canonicalSkillPath } from '@shared/skill-catalog'
import { st } from './worker-runtime.js'

export type WorkerSkillOverrides = Record<string, boolean>

function settingsPath(): string {
  if (!st.sdk) throw new Error('SDK_NOT_READY')
  return join(st.sdk.getAgentDir(), 'settings.json')
}

function readSettings(): Record<string, unknown> {
  if (!st.sdk) return {}
  const path = settingsPath()
  if (!existsSync(path)) return {}
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as Record<string, unknown>
  } catch (error) {
    throw new Error(`PI_SETTINGS_INVALID_JSON: ${error instanceof Error ? error.message : String(error)}`)
  }
}

export function readWorkerSkillOverrides(): WorkerSkillOverrides {
  const raw = readSettings().desktopSkillOverrides
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const overrides: WorkerSkillOverrides = {}
  for (const [key, value] of Object.entries(raw)) {
    if (value === false) overrides[key] = false
  }
  return overrides
}

export function writeWorkerSkillOverrides(
  changes: Array<{ filePath: string; enabled: boolean }>,
): WorkerSkillOverrides {
  const settings = readSettings()
  const overrides = { ...readWorkerSkillOverrides() }
  for (const change of changes) {
    const key = `path:${canonicalSkillPath(change.filePath)}`
    if (change.enabled) delete overrides[key]
    else overrides[key] = false
  }
  settings.desktopSkillOverrides = overrides
  const path = settingsPath()
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(settings, null, 2), 'utf-8')
  return overrides
}
