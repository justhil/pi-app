import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { resolveActiveAgentDir } from './agent-dir'

function readSettingsFile(path: string): Record<string, unknown> | null {
  try {
    if (!existsSync(path)) return null
    const raw = JSON.parse(readFileSync(path, 'utf-8'))
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null
  } catch {
    return null
  }
}

/** Worker 未运行时从 ~/.pi/agent/settings.json 读取（仅读，不写）。 */
export function readPiAgentGlobalSettingsFromDisk(): Record<string, unknown> | null {
  return readSettingsFile(join(resolveActiveAgentDir(), 'settings.json'))
}

/** Worker 未运行时从 <cwd>/.pi/settings.json 读取（仅读，不写）。 */
export function readPiProjectSettingsFromDisk(cwd: string): Record<string, unknown> | null {
  return readSettingsFile(join(cwd, '.pi', 'settings.json'))
}
