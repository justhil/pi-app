import { probeExtensions } from '../extension-compat/extension-probe'
import { loadAdapterCatalog, v2DisplayInfo } from '../extension-compat/adapter-loader'
import { listPromptsOnDisk, listSkillsOnDisk } from './pi-resources-editor'

export type SlashCatalogCommand = {
  id: string
  name: string
  description?: string
  category: 'prompt' | 'skill' | 'extension'
  source?: { path?: string; filePath?: string }
}

function withSlash(n: string): string {
  return n.startsWith('/') ? n : `/${n}`
}

function invocationFromSlashName(name: string): string {
  const s = withSlash(name)
  return s.startsWith('/') ? s.slice(1) : s
}

/** adapter.json slash + match.commands（不依赖 Worker session） */
function collectAdapterCatalogCommands(cwd: string): SlashCatalogCommand[] {
  const out: SlashCatalogCommand[] = []
  for (const a of loadAdapterCatalog(cwd).adapters) {
    if (a.tier === 'none') continue
    const info = v2DisplayInfo(a.id, cwd)
    if (!info) continue
    for (const cmd of info.registeredCommands) {
      const inv = invocationFromSlashName(cmd)
      if (!inv) continue
      out.push({
        id: inv,
        name: withSlash(inv),
        description: info.description || info.displayName,
        category: 'extension',
      })
    }
  }
  return out
}

/** Disk + extension probe — no AgentSession; usable during timeline preview / pendingBind. */
export function scanStaticSlashCommands(cwd: string): SlashCatalogCommand[] {
  const out: SlashCatalogCommand[] = []
  const seen = new Set<string>()

  const push = (c: SlashCatalogCommand) => {
    const key = c.name.toLowerCase()
    if (seen.has(key)) return
    seen.add(key)
    out.push(c)
  }

  for (const p of listPromptsOnDisk(cwd)) {
    push({
      id: p.name,
      name: p.command.startsWith('/') ? p.command : withSlash(p.name),
      description: p.description,
      category: 'prompt',
      source: { path: p.path },
    })
  }

  for (const s of listSkillsOnDisk(cwd)) {
    const skillName = s.name.startsWith('skill:') ? s.name : `skill:${s.name}`
    push({
      id: s.name,
      name: withSlash(skillName),
      description: s.description,
      category: 'skill',
      source: { path: s.path },
    })
  }

  for (const ext of probeExtensions(cwd)) {
    const cmds = new Set<string>(ext.registeredCommands)
    const v2 = v2DisplayInfo(
      ext.adapterId || ext.packageName || ext.name,
      cwd,
    )
    if (v2?.registeredCommands) {
      for (const c of v2.registeredCommands) cmds.add(c)
    }
    for (const raw of cmds) {
      const inv = invocationFromSlashName(raw)
      if (!inv) continue
      push({
        id: inv,
        name: withSlash(inv),
        description: ext.description || ext.name,
        category: 'extension',
      })
    }
  }

  for (const c of collectAdapterCatalogCommands(cwd)) {
    push(c)
  }

  return out
}

export function mergeSlashCommandLists(
  primary: SlashCatalogCommand[],
  secondary: SlashCatalogCommand[],
): SlashCatalogCommand[] {
  const byKey = new Map<string, SlashCatalogCommand>()
  for (const c of secondary) byKey.set(c.name.toLowerCase(), c)
  for (const c of primary) byKey.set(c.name.toLowerCase(), c)
  return [...byKey.values()].sort((a, b) => a.name.localeCompare(b.name))
}

export function slashInvocationNames(commands: { name?: string; id?: string }[]): string[] {
  const names: string[] = []
  for (const c of commands) {
    const n = String(c.name || c.id || '')
    if (n) names.push(n)
  }
  return names
}