import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'fs'
import { join, basename, dirname, resolve } from 'path'
import { homedir } from 'os'

export type ResourceSource = 'project' | 'global' | 'settings' | 'package' | 'unknown'

export type SkillListItem = {
  name: string
  description: string
  path: string
  source: ResourceSource
  fileKind: 'skill-md' | 'md'
}

export type PromptListItem = {
  name: string
  description: string
  path: string
  source: ResourceSource
  command: string
}

function agentDir() {
  return join(homedir(), '.pi', 'agent')
}

function parseFrontmatter(raw: string): { meta: Record<string, string>; body: string } {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/)
  if (!m) return { meta: {}, body: raw }
  const meta: Record<string, string> = {}
  for (const line of m[1].split('\n')) {
    const idx = line.indexOf(':')
    if (idx < 0) continue
    const k = line.slice(0, idx).trim()
    let v = line.slice(idx + 1).trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
    meta[k] = v
  }
  return { meta, body: m[2] }
}

function scanSkillMdFiles(dir: string, source: ResourceSource, out: SkillListItem[]) {
  if (!existsSync(dir)) return
  const walk = (d: string) => {
    let entries: string[]
    try {
      entries = readdirSync(d)
    } catch {
      return
    }
    for (const name of entries) {
      if (name.startsWith('.')) continue
      const full = join(d, name)
      let st
      try {
        st = statSync(full)
      } catch {
        continue
      }
      if (st.isDirectory()) {
        const skillMd = join(full, 'SKILL.md')
        if (existsSync(skillMd)) {
          const raw = readFileSync(skillMd, 'utf-8')
          const { meta, body } = parseFrontmatter(raw)
          out.push({
            name: meta.name || basename(full),
            description: meta.description || body.trim().split('\n').find((l) => l.trim())?.slice(0, 200) || '',
            path: skillMd,
            source,
            fileKind: 'skill-md',
          })
        } else walk(full)
      } else if (name.endsWith('.md') && d === dir) {
        const raw = readFileSync(full, 'utf-8')
        const { meta, body } = parseFrontmatter(raw)
        out.push({
          name: meta.name || basename(name, '.md'),
          description: meta.description || body.trim().split('\n').find((l) => l.trim())?.slice(0, 200) || '',
          path: full,
          source,
          fileKind: 'md',
        })
      }
    }
  }
  walk(dir)
}

export function listSkillsOnDisk(cwd: string): SkillListItem[] {
  const out: SkillListItem[] = []
  scanSkillMdFiles(join(cwd, '.pi', 'skills'), 'project', out)
  scanSkillMdFiles(join(agentDir(), 'skills'), 'global', out)
  const seen = new Set<string>()
  return out.filter((s) => {
    const k = s.path.toLowerCase()
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
}

function scanPromptsDir(dir: string, source: ResourceSource, out: PromptListItem[]) {
  if (!existsSync(dir)) return
  try {
    for (const name of readdirSync(dir)) {
      if (!name.endsWith('.md') || name.startsWith('.')) continue
      const full = join(dir, name)
      const raw = readFileSync(full, 'utf-8')
      const { meta, body } = parseFrontmatter(raw)
      const cmdName = basename(name, '.md')
      out.push({
        name: cmdName,
        description: meta.description || body.trim().split('\n').find((l) => l.trim())?.slice(0, 200) || '',
        path: full,
        source,
        command: `/${cmdName}`,
      })
    }
  } catch {
    /* */
  }
}

export function listPromptsOnDisk(cwd: string): PromptListItem[] {
  const out: PromptListItem[] = []
  scanPromptsDir(join(cwd, '.pi', 'prompts'), 'project', out)
  scanPromptsDir(join(agentDir(), 'prompts'), 'global', out)
  const seen = new Set<string>()
  return out.filter((p) => {
    const k = `${p.source}:${p.name}`
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
}

export function readTextFileSafe(path: string): { content: string; path: string } {
  const resolved = resolve(path)
  if (!existsSync(resolved)) throw new Error('文件不存在')
  return { content: readFileSync(resolved, 'utf-8'), path: resolved }
}

export function writeTextFileSafe(path: string, content: string): void {
  const resolved = resolve(path)
  const dir = dirname(resolved)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(resolved, content, 'utf-8')
}

export function skillStorageKey(name: string, filePath?: string) {
  return filePath ? `path:${filePath}` : `name:${name}`
}