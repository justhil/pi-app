import { existsSync, readFileSync, writeFileSync, readdirSync, statSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

const AGENT_DIR = () => join(homedir(), '.pi', 'agent')

/** 与终端常用、但常被漏写进 settings.packages 的 git 包 */
const RECOMMENDED_GIT_PACKAGES: { entry: string; repoFolder: string }[] = [
  { entry: 'git:github.com/justhil/pi-search', repoFolder: 'pi-search' },
  { entry: 'git:github.com/justhil/pi-fast-context', repoFolder: 'pi-fast-context' },
]

function findGitRepoDir(agentDir: string, repoFolder: string): string | null {
  const gitRoot = join(agentDir, 'git')
  if (!existsSync(gitRoot)) return null
  const walk = (dir: string, depth: number): string | null => {
    if (depth > 4) return null
    let entries: string[] = []
    try {
      entries = readdirSync(dir)
    } catch {
      return null
    }
    for (const name of entries) {
      if (name === '.git' || name === 'node_modules' || name.startsWith('.')) continue
      const full = join(dir, name)
      try {
        if (!statSync(full).isDirectory()) continue
      } catch {
        continue
      }
      if (name === repoFolder && existsSync(join(full, 'package.json'))) return full
      const hit = walk(full, depth + 1)
      if (hit) return hit
    }
    return null
  }
  return walk(gitRoot, 0)
}

function packagesEntries(settings: { packages?: unknown[] }): unknown[] {
  return Array.isArray(settings.packages) ? settings.packages : []
}

function entryKey(entry: unknown): string {
  if (typeof entry === 'string') return entry
  if (entry && typeof entry === 'object' && 'source' in entry) return String((entry as { source: string }).source)
  return ''
}

export type MissingRuntimePackage = {
  entry: string
  repoFolder: string
  repoPath: string | null
  reason: string
}

/** 本机有 git 克隆但未写入 settings.packages → Worker 不会加载 */
export function listMissingRuntimePackages(): MissingRuntimePackage[] {
  const agentDir = AGENT_DIR()
  const settingsPath = join(agentDir, 'settings.json')
  if (!existsSync(settingsPath)) return []
  let settings: { packages?: unknown[] }
  try {
    settings = JSON.parse(readFileSync(settingsPath, 'utf-8'))
  } catch {
    return []
  }
  const existing = new Set(packagesEntries(settings).map(entryKey))

  const out: MissingRuntimePackage[] = []
  for (const rec of RECOMMENDED_GIT_PACKAGES) {
    if (existing.has(rec.entry)) continue
    const repoPath = findGitRepoDir(agentDir, rec.repoFolder)
    if (!repoPath) continue
    out.push({
      entry: rec.entry,
      repoFolder: rec.repoFolder,
      repoPath,
      reason: '已在 ~/.pi/agent/git 发现克隆，但未列入 settings.packages，Pi Worker 不会加载其扩展',
    })
  }
  return out
}

/** 将缺失的推荐 git 包追加到 ~/.pi/agent/settings.json（与 pi-image-gen 同写法） */
export function appendMissingGitPackagesToSettings(): { added: string[]; error?: string } {
  const missing = listMissingRuntimePackages()
  if (missing.length === 0) return { added: [] }

  const agentDir = AGENT_DIR()
  const settingsPath = join(agentDir, 'settings.json')
  let settings: { packages?: unknown[] }
  try {
    settings = JSON.parse(readFileSync(settingsPath, 'utf-8'))
  } catch (e: any) {
    return { added: [], error: e.message }
  }

  const packages = packagesEntries(settings)
  const added: string[] = []
  for (const m of missing) {
    if (!packages.some((e) => entryKey(e) === m.entry)) {
      packages.push(m.entry)
      added.push(m.entry)
    }
  }
  if (added.length === 0) return { added: [] }

  settings.packages = packages
  try {
    writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n', 'utf-8')
  } catch (e: any) {
    return { added: [], error: e.message }
  }
  return { added }
}