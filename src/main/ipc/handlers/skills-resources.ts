import { existsSync } from 'fs'
import { resolve } from 'path'
import { registerHandler } from '../registry'
import { workerManager } from '../../worker-manager'
import { configStore } from '../../config-store'
import {
  listSkillsOnDisk,
  listPromptsOnDisk,
  readTextFileSafe,
  writeTextFileSafe,
  skillStorageKey,
} from '../../pi-resources-editor'
import {
  getDesktopSkillOverrides,
  isSkillEnabled,
  setSkillEnabledInGlobal,
  applySkillOverridesBatch,
  migrateElectronSkillOverrides,
} from '../../pi-skill-overrides'
import {
  listAgentsContextFiles,
  listPiBuiltinPromptFiles,
  listPluginInjectedPromptFiles,
  groupPromptCatalog,
  PI_GLOBAL_SYSTEM_MD,
  type PromptCatalogItem,
} from '../../pi-prompt-catalog'
import { listRevisions, pushRevision, restoreRevision, readRevision } from '../../resource-revisions'
import type { ResourceSource } from '../../pi-resources-editor'
import { errorMessage } from '@shared/error-message'

export function registerSkillsResourceHandlers(): void {
  registerHandler('ipc:skills.list', async () => {
    const legacy = configStore.getSkillOverrides()
    if (legacy && Object.keys(legacy).length > 0) {
      migrateElectronSkillOverrides(legacy)
      configStore.set('skillOverrides', {})
    }
    const cwd = workerManager.cwd || configStore.get('currentProject') || process.cwd()
    const overrides = getDesktopSkillOverrides()
    const disk = listSkillsOnDisk(cwd)
    let worker: { name: string; path?: string; description?: string; source?: string }[] = []
    if (workerManager.isRunning) {
      try {
        worker = await workerManager.getSkillsList()
      } catch (e) {
        console.error('[IPC] skills.list worker failed:', e)
      }
    }
    const byPath = new Map<string, Record<string, unknown>>()
    for (const s of disk) {
      const key = skillStorageKey(s.name, s.path)
      byPath.set(s.path, {
        ...s,
        key,
        enabled: isSkillEnabled(s.name, s.path, overrides),
        command: `/skill:${s.name}`,
      })
    }
    for (const s of worker) {
      const path = s.path || ''
      const key = skillStorageKey(s.name, path || undefined)
      const existing = path ? byPath.get(path) : undefined
      const row = {
        name: s.name,
        description: s.description || (existing?.description as string) || '',
        path: path || (existing?.path as string),
        source: s.source || (existing?.source as string) || 'unknown',
        key,
        enabled: isSkillEnabled(s.name, path || (existing?.path as string), overrides),
        command: `/skill:${s.name}`,
        fromWorker: true,
      }
      if (path) byPath.set(path, { ...existing, ...row })
      else if (![...byPath.values()].some((x) => x.name === s.name)) {
        byPath.set(`worker:${s.name}`, row)
      }
    }
    return { skills: [...byPath.values()] }
  })

  registerHandler('ipc:skills.setEnabled', async (req) => {
    const name = String(req.name || '')
    const path = req.path ? String(req.path) : undefined
    const enabled = req.enabled !== false
    if (!name && !path) return { ok: false }
    const overrides = setSkillEnabledInGlobal(name || 'unknown', path, enabled)
    const key = skillStorageKey(name, path)
    if (workerManager.isRunning) await workerManager.reloadResources().catch(() => {})
    return { ok: true, key, enabled: isSkillEnabled(name, path, overrides) }
  })

  registerHandler('ipc:skills.applyOverrides', async (req) => {
    const changes = Array.isArray(req?.changes) ? req.changes : []
    const normalized = changes
      .map((c: { name?: string; path?: string; enabled?: boolean }) => ({
        name: String(c?.name || ''),
        path: c?.path ? String(c.path) : undefined,
        enabled: c?.enabled !== false,
      }))
      .filter((c: { name: string; path?: string }) => c.name || c.path)
    applySkillOverridesBatch(normalized)
    return { ok: true, count: normalized.length }
  })

  registerHandler('ipc:prompts.list', async () => {
    const cwd = workerManager.cwd || configStore.get('currentProject') || process.cwd()
    let projectTrusted = true
    let defaultSystemPreview = ''
    if (workerManager.isRunning) {
      try {
        const ctx = await workerManager.getContextPrompts()
        projectTrusted = ctx.projectTrusted !== false
        defaultSystemPreview = String(ctx.builtSystemPreview || '')
      } catch (e) {
        /* */
      }
    }

    const byPath = new Map<string, PromptCatalogItem>()
    const push = (item: PromptCatalogItem) => {
      const k = item.path?.toLowerCase() || item.id
      if (!byPath.has(k)) byPath.set(k, item)
    }

    for (const a of listAgentsContextFiles(cwd)) push(a)
    for (const b of listPiBuiltinPromptFiles(cwd, projectTrusted)) {
      if (b.id === 'builtin:system:default' && defaultSystemPreview) {
        push({ ...b, description: '当前会话实际组装的 system 提示词（只读预览）' })
      } else push(b)
    }
    for (const plug of listPluginInjectedPromptFiles(cwd)) push(plug)

    const disk = listPromptsOnDisk(cwd)
    const tplByPath = new Map<string, (typeof disk)[0]>()
    for (const p of disk) tplByPath.set(p.path, p)
    if (workerManager.isRunning) {
      try {
        const worker = await workerManager.getPromptTemplatesList()
        for (const t of worker) {
          const path = t.path || ''
          if (path && tplByPath.has(path)) {
            const cur = tplByPath.get(path)!
            tplByPath.set(path, { ...cur, description: t.description || cur.description })
          } else if (path) {
            tplByPath.set(path, {
              name: t.name,
              description: t.description || '',
              path,
              source: (String(t.source || 'unknown') as ResourceSource),
              command: `/${t.name}`,
            })
          }
        }
      } catch (e) {
        console.error('[IPC] prompts.list templates worker failed:', e)
      }
    }
    for (const p of tplByPath.values()) {
      push({
        id: `template:${p.path}`,
        category: 'prompt_template',
        name: p.name,
        description: p.description,
        path: p.path,
        command: p.command,
        source: p.source,
        editable: true,
        inSystemContext: false,
      })
    }

    const prompts = [...byPath.values()]
    return {
      prompts,
      groups: groupPromptCatalog(prompts),
      defaultSystemPreview,
      virtualSystemPreviewPath: 'pi-desktop://system-prompt-preview',
    }
  })

  registerHandler('ipc:resource.read', async (req) => {
    const path = String(req.path || '')
    if (!path) return { error: 'missing path' }
    if (path === 'pi-desktop://system-prompt-preview') {
      try {
        if (!workerManager.isRunning) {
          return { content: '（Worker 未启动，打开工作区后重试）', path, revisions: [] }
        }
        const ctx = await workerManager.getContextPrompts()
        return { content: String(ctx.builtSystemPreview || '（空）'), path, revisions: [] }
      } catch (e: unknown) {
        return { error: errorMessage(e) }
      }
    }
    const resolved = resolve(path)
    const isGlobalSystem = resolved.toLowerCase() === resolve(PI_GLOBAL_SYSTEM_MD).toLowerCase()
    if (isGlobalSystem && !existsSync(resolved)) {
      let seed =
        '# pi 系统提示词\n\n' +
        '保存本文件后将替换 pi 内置 harness 默认文案（与终端 pi 的 SYSTEM.md 一致）。\n\n'
      if (workerManager.isRunning) {
        try {
          const ctx = await workerManager.getContextPrompts()
          const built = String(ctx.builtSystemPreview || '').trim()
          if (built) seed = built
        } catch (e) {
          /* */
        }
      }
      return { content: seed, path: resolved, revisions: [] }
    }
    try {
      const { content, path: resolvedPath } = readTextFileSafe(path)
      return { content, path: resolvedPath, revisions: listRevisions(resolvedPath) }
    } catch (e: unknown) {
      return { error: errorMessage(e) }
    }
  })

  registerHandler('ipc:resource.write', async (req) => {
    const path = String(req.path || '')
    if (path.startsWith('pi-desktop://')) return { ok: false, error: '只读预览不可保存' }
    const content = String(req.content ?? '')
    if (!path) return { ok: false, error: 'missing path' }
    try {
      pushRevision(path, req.revisionLabel || '保存前')
      writeTextFileSafe(path, content)
      if (workerManager.isRunning) await workerManager.reloadResources().catch(() => {})
      return { ok: true, revisions: listRevisions(path) }
    } catch (e: unknown) {
      return { ok: false, error: errorMessage(e) }
    }
  })

  registerHandler('ipc:resource.revisions', async (req) => {
    const path = String(req.path || '')
    return { revisions: path ? listRevisions(path) : [] }
  })

  registerHandler('ipc:resource.restore', async (req) => {
    const path = String(req.path || '')
    const revisionId = String(req.revisionId || '')
    if (!path || !revisionId) return { ok: false }
    try {
      restoreRevision(path, revisionId)
      if (workerManager.isRunning) await workerManager.reloadResources().catch(() => {})
      const { content } = readTextFileSafe(path)
      return { ok: true, content, revisions: listRevisions(path) }
    } catch (e: unknown) {
      return { ok: false, error: errorMessage(e) }
    }
  })

  registerHandler('ipc:resource.revision.read', async (req) => {
    try {
      return { content: readRevision(String(req.path), String(req.revisionId)) }
    } catch (e: unknown) {
      return { error: errorMessage(e) }
    }
  })
}