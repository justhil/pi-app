import { existsSync, readFileSync, readdirSync, statSync } from 'fs'
import { join, resolve, basename, dirname } from 'path'
import { homedir } from 'os'
import { readGlobalSettingsJson } from './pi-skill-overrides'

export type PromptCategory = 'plugin_inject' | 'agents_context' | 'pi_builtin' | 'prompt_template'

export type PromptCatalogItem = {
  id: string
  category: PromptCategory
  name: string
  description: string
  path: string | null
  command: string
  source?: string
  editable: boolean
  readOnly?: boolean
  /** 是否已进入每轮 system 上下文 */
  inSystemContext?: boolean
}

export const PI_AGENT_DIR = join(homedir(), '.pi', 'agent')
export const PI_GLOBAL_SYSTEM_MD = join(PI_AGENT_DIR, 'SYSTEM.md')

const AGENT_DIR = PI_AGENT_DIR
const CONTEXT_NAMES = ['AGENTS.md', 'AGENTS.MD', 'CLAUDE.md', 'CLAUDE.MD']

function loadContextFileFromDir(dir: string): { path: string; content: string } | null {
  for (const filename of CONTEXT_NAMES) {
    const filePath = join(dir, filename)
    if (existsSync(filePath)) {
      try {
        return { path: filePath, content: readFileSync(filePath, 'utf-8') }
      } catch {
        /* */
      }
    }
  }
  return null
}

/** 与 pi loadProjectContextFiles 一致：全局 agentDir + cwd 祖先链 */
export function listAgentsContextFiles(cwd: string): PromptCatalogItem[] {
  const resolvedCwd = resolve(cwd)
  const items: PromptCatalogItem[] = []
  const seen = new Set<string>()

  const global = loadContextFileFromDir(AGENT_DIR)
  if (global) {
    seen.add(global.path.toLowerCase())
    items.push({
      id: `agents:${global.path}`,
      category: 'agents_context',
      name: basename(global.path),
      description: '全局 agent 目录下的项目上下文（进入 <project_context>）',
      path: global.path,
      command: '',
      source: 'global',
      editable: true,
      inSystemContext: true,
    })
  }

  const ancestor: { path: string; content: string }[] = []
  let currentDir = resolvedCwd
  const root = resolve('/')
  while (true) {
    const ctx = loadContextFileFromDir(currentDir)
    if (ctx && !seen.has(ctx.path.toLowerCase())) {
      ancestor.unshift(ctx)
      seen.add(ctx.path.toLowerCase())
    }
    if (currentDir === root) break
    const parent = resolve(currentDir, '..')
    if (parent === currentDir) break
    currentDir = parent
  }

  for (const ctx of ancestor) {
    const rel = ctx.path.startsWith(resolvedCwd) ? ctx.path.slice(resolvedCwd.length).replace(/^[/\\]/, '') : ctx.path
    items.push({
      id: `agents:${ctx.path}`,
      category: 'agents_context',
      name: basename(ctx.path),
      description: rel ? `工作区路径：${rel}` : ctx.path,
      path: ctx.path,
      command: '',
      source: 'project',
      editable: true,
      inSystemContext: true,
    })
  }
  return items
}

export function listPiBuiltinPromptFiles(cwd: string, projectTrusted = true): PromptCatalogItem[] {
  const out: PromptCatalogItem[] = []
  const projectSystem = join(cwd, '.pi', 'SYSTEM.md')
  const globalSystem = PI_GLOBAL_SYSTEM_MD
  const projectAppend = join(cwd, '.pi', 'APPEND_SYSTEM.md')
  const globalAppend = join(AGENT_DIR, 'APPEND_SYSTEM.md')

  if (projectTrusted && existsSync(projectSystem)) {
    out.push({
      id: `builtin:system:project`,
      category: 'pi_builtin',
      name: 'SYSTEM.md（项目）',
      description: '替换默认 harness 系统提示词（优先于全局 SYSTEM.md）',
      path: projectSystem,
      command: '',
      source: 'project',
      editable: true,
      inSystemContext: true,
    })
  }

  const globalExists = existsSync(globalSystem)
  out.push({
    id: 'builtin:system:global',
    category: 'pi_builtin',
    name: globalExists ? 'SYSTEM.md（全局）' : 'SYSTEM.md（全局 · 可编辑）',
    description: globalExists
      ? '替换默认 harness 系统提示词'
      : '尚未创建；保存后将写入 ~/.pi/agent/SYSTEM.md，并替换内置默认文案',
    path: globalSystem,
    command: '',
    source: 'global',
    editable: true,
    inSystemContext: !existsSync(projectSystem) || !projectTrusted,
  })

  if (!globalExists && !(projectTrusted && existsSync(projectSystem))) {
    out.push({
      id: 'builtin:system:default',
      category: 'pi_builtin',
      name: '当前内置 system（只读预览）',
      description: '未配置 SYSTEM.md 时 Worker 实际使用的组装结果；要修改请编辑上方全局 SYSTEM.md',
      path: null,
      command: '',
      source: 'builtin',
      editable: false,
      readOnly: true,
      inSystemContext: true,
    })
  }

  if (projectTrusted && existsSync(projectAppend)) {
    out.push({
      id: `builtin:append:project`,
      category: 'pi_builtin',
      name: 'APPEND_SYSTEM.md（项目）',
      description: '追加到系统提示词末尾',
      path: projectAppend,
      command: '',
      source: 'project',
      editable: true,
      inSystemContext: true,
    })
  }
  if (existsSync(globalAppend)) {
    const dup = out.some((x) => x.path === globalAppend)
    if (!dup) {
      out.push({
        id: `builtin:append:global`,
        category: 'pi_builtin',
        name: 'APPEND_SYSTEM.md（全局）',
        description: '追加到系统提示词末尾',
        path: globalAppend,
        command: '',
        source: 'global',
        editable: true,
        inSystemContext: true,
      })
    }
  }
  return out
}

function walkMdFiles(dir: string, maxDepth: number, depth: number, out: string[]): void {
  if (depth > maxDepth || !existsSync(dir)) return
  try {
    for (const name of readdirSync(dir)) {
      if (name.startsWith('.') || name === 'node_modules') continue
      const full = join(dir, name)
      const st = statSync(full)
      if (st.isDirectory()) walkMdFiles(full, maxDepth, depth + 1, out)
      else if (name.endsWith('.md')) out.push(full)
    }
  } catch {
    /* */
  }
}

/** 扩展包内 prompts/ 或 pi 声明的注入型说明（非标准 .pi/prompts 模板目录） */
export function listPluginInjectedPromptFiles(cwd: string): PromptCatalogItem[] {
  const settings = readGlobalSettingsJson()
  const packages = Array.isArray(settings.packages) ? settings.packages : []
  const seen = new Set<string>()
  const items: PromptCatalogItem[] = []

  const npmRoot = join(AGENT_DIR, 'npm', 'node_modules')
  const gitRoot = join(AGENT_DIR, 'git')

  const addFile = (full: string, pkgLabel: string) => {
    const key = full.toLowerCase()
    if (seen.has(key)) return
    seen.add(key)
    const base = basename(full)
    if (['AGENTS.md', 'CLAUDE.md', 'SYSTEM.md', 'APPEND_SYSTEM.md'].includes(base)) return
    items.push({
      id: `plugin:${full}`,
      category: 'plugin_inject',
      name: base,
      description: `扩展包资源 · ${pkgLabel}`,
      path: full,
      command: '',
      source: 'package',
      editable: true,
      inSystemContext: false,
    })
  }

  for (const pkg of packages) {
    let pkgDir: string | null = null
    let label = String(pkg)
    if (typeof pkg === 'string') {
      if (pkg.startsWith('git:')) {
        const parts = pkg.replace(/^git:/, '').split('/')
        if (parts.length >= 2) {
          const repo = parts[parts.length - 1]
          const host = parts[0]
          const owner = parts[1]
          const cand = join(gitRoot, host, owner, repo)
          if (existsSync(cand)) pkgDir = cand
        }
      } else if (existsSync(join(npmRoot, pkg))) {
        pkgDir = join(npmRoot, pkg)
        label = pkg
      }
    } else if (pkg && typeof pkg === 'object' && 'name' in pkg) {
      const name = String((pkg as { name: string }).name)
      if (existsSync(join(npmRoot, name))) {
        pkgDir = join(npmRoot, name)
        label = name
      }
    }
    if (!pkgDir) continue
    const promptsDir = join(pkgDir, 'prompts')
    if (existsSync(promptsDir)) {
      const files: string[] = []
      walkMdFiles(promptsDir, 2, 0, files)
      for (const f of files) addFile(f, label)
    }
  }

  const extDirs = [join(AGENT_DIR, 'extensions'), join(cwd, '.pi', 'extensions')]
  for (const extDir of extDirs) {
    if (!existsSync(extDir)) continue
    try {
      for (const name of readdirSync(extDir)) {
        const full = join(extDir, name)
        if (!statSync(full).isFile() || !name.endsWith('.md')) continue
        addFile(full, `extension:${name}`)
      }
    } catch {
      /* */
    }
  }

  return items
}

export const PROMPT_GROUP_LABELS: Record<PromptCategory, string> = {
  plugin_inject: '插件注入',
  agents_context: '项目上下文（AGENTS.md 等）',
  pi_builtin: 'pi 内置 / SYSTEM',
  prompt_template: '提示词模板（/name）',
}

export function groupPromptCatalog(items: PromptCatalogItem[]): { category: PromptCategory; label: string; items: PromptCatalogItem[] }[] {
  const order: PromptCategory[] = ['agents_context', 'pi_builtin', 'prompt_template', 'plugin_inject']
  return order
    .map((category) => ({
      category,
      label: PROMPT_GROUP_LABELS[category],
      items: items.filter((i) => i.category === category),
    }))
    .filter((g) => g.items.length > 0)
}