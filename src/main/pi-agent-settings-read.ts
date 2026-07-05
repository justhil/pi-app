import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

/** Worker 未运行时从 ~/.pi/agent/settings.json 读取（仅读，不写）。 */
export function readPiAgentGlobalSettingsFromDisk(): Record<string, unknown> | null {
  try {
    const p = join(homedir(), '.pi', 'agent', 'settings.json')
    if (!existsSync(p)) return null
    const raw = JSON.parse(readFileSync(p, 'utf-8'))
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null
  } catch (e) {
    return null
  }
}