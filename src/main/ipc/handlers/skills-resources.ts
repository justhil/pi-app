import { existsSync } from 'fs'
import { resolve } from 'path'
import { registerHandler } from '../registry'
import { workerManager } from '../../worker-manager'
import { configStore } from '../../config-store'
import {
  listPromptsOnDisk,
  readTextFileSafe,
  writeTextFileSafe,
} from '../../pi-resources-editor'
import { migrateElectronSkillOverrides } from '../../pi-skill-overrides'
import {
  listAgentsContextFiles,
  listPiBuiltinPromptFiles,
  listPluginInjectedPromptFiles,
  groupPromptCatalog,
  getGlobalSystemMd,
  type PromptCatalogItem,
} from '../../pi-prompt-catalog'
import { listRevisions, pushRevision, restoreRevision, readRevision } from '../../resource-revisions'
import type { ResourceSource } from '../../pi-resources-editor'
import { errorMessage } from '@shared/error-message'
import { normalizeSessionKey } from '../../worker-session-key'
import { sessionPreviewProcess } from '../../session-preview-process'
import {
  readPiAgentGlobalSettingsFromDisk,
  readPiProjectSettingsFromDisk,
} from '../../pi-agent-settings-read'

export function registerSkillsResourceHandlers(): void {
  registerHandler('ipc:skills.list', async () => {
    const legacy = configStore.getSkillOverrides()
    if (legacy && Object.keys(legacy).length > 0) {
      migrateElectronSkillOverrides(legacy)
      configStore.set('skillOverrides', {})
    }
    const cwd = configStore.get('currentProject')
    if (!cwd) {
      return { complete: false, projectTrusted: false, effectiveSkills: [], candidates: [], skills: [] }
    }
    if (
      !workerManager.isRunning ||
      normalizeSessionKey(workerManager.cwd || '') !== normalizeSessionKey(cwd)
    ) {
      await workerManager.start(cwd)
    }
    const catalog = await workerManager.getSkillsList()
    const presentation = configStore.get('skillPresentation') || {}
    const candidates = catalog.candidates.map((candidate) => ({
      ...candidate,
      path: candidate.filePath,
      alias: presentation[candidate.key]?.alias,
      icon: presentation[candidate.key]?.icon,
    }))
    return { ...catalog, candidates, skills: candidates }
  })

  registerHandler('ipc:skills.setEnabled', async (req) => {
    const key = String(req.key || '')
    if (!key || !workerManager.isRunning) return { ok: false, error: 'SKILL_RUNTIME_NOT_READY' }
    try {
      const count = await workerManager.applySkillOverrides([{ key, enabled: req.enabled !== false }])
      await workerManager.reloadResources()
      return { ok: true, count }
    } catch (error) {
      return { ok: false, error: errorMessage(error) }
    }
  })

  registerHandler('ipc:skills.applyOverrides', async (req) => {
    const changes = Array.isArray(req?.changes)
      ? req.changes.map((change: { key?: unknown; enabled?: unknown }) => ({
          key: String(change.key || ''),
          enabled: change.enabled !== false,
        })).filter((change: { key: string }) => change.key)
      : []
    if (!workerManager.isRunning) return { ok: false, error: 'SKILL_RUNTIME_NOT_READY' }
    try {
      const count = await workerManager.applySkillOverrides(changes)
      await workerManager.reloadResources()
      return { ok: true, count }
    } catch (error) {
      return { ok: false, error: errorMessage(error) }
    }
  })

  registerHandler('ipc:skills.description.write', async (req) => {
    if (!workerManager.isRunning) return { ok: false, error: 'SKILL_RUNTIME_NOT_READY' }
    try {
      const description = await workerManager.writeSkillDescription(
        String(req.key || ''),
        String(req.description || ''),
      )
      await workerManager.reloadResources()
      return { ok: true, description }
    } catch (error) {
      return { ok: false, error: errorMessage(error) }
    }
  })

  registerHandler('ipc:skills.transfer', async (req) => {
    if (!workerManager.isRunning) return { ok: false, error: 'SKILL_RUNTIME_NOT_READY' }
    try {
      const result = await workerManager.transferSkill(
        String(req.key || ''),
        req.target === 'project' ? 'project' : 'user',
        req.mode === 'move' ? 'move' : 'copy',
      )
      await workerManager.reloadResources()
      return result
    } catch (error) {
      return { ok: false, error: errorMessage(error) }
    }
  })

  registerHandler('ipc:prompts.list', async () => {
    const cwd = configStore.get('currentProject') || workerManager.cwd || process.cwd()
    const useLiveWorker =
      workerManager.isRunning &&
      normalizeSessionKey(workerManager.cwd || '') === normalizeSessionKey(cwd)
    let projectTrusted = true
    let defaultSystemPreview = ''
    if (useLiveWorker) {
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
    if (useLiveWorker) {
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
        const cwd = configStore.get('currentProject') || workerManager.cwd || process.cwd()
        if (
          workerManager.isRunning &&
          normalizeSessionKey(workerManager.cwd || '') === normalizeSessionKey(cwd)
        ) {
          const ctx = await workerManager.getContextPrompts()
          return { content: String(ctx.builtSystemPreview || '（空）'), path, revisions: [] }
        }
        return {
          content: await sessionPreviewProcess.getSystemPrompt({
            cwd,
            globalSettings: readPiAgentGlobalSettingsFromDisk() || {},
            projectSettings: readPiProjectSettingsFromDisk(cwd) || {},
          }),
          path,
          revisions: [],
        }
      } catch (e: unknown) {
        return { error: errorMessage(e) }
      }
    }
    const resolved = resolve(path)
    const isGlobalSystem = resolved.toLowerCase() === resolve(getGlobalSystemMd()).toLowerCase()
    if (isGlobalSystem && !existsSync(resolved)) {
      let seed =
        '# pi 系统提示词\n\n' +
        '保存本文件后将替换 pi 内置 harness 默认文案（与终端 pi 的 SYSTEM.md 一致）。\n\n'
      const cwd = configStore.get('currentProject') || workerManager.cwd || process.cwd()
      if (
        workerManager.isRunning &&
        normalizeSessionKey(workerManager.cwd || '') === normalizeSessionKey(cwd)
      ) {
        try {
          const ctx = await workerManager.getContextPrompts()
          const built = String(ctx.builtSystemPreview || '').trim()
          if (built) seed = built
        } catch (e) {
          /* */
        }
      } else {
        try {
          const built = (await sessionPreviewProcess.getSystemPrompt({
            cwd,
            globalSettings: readPiAgentGlobalSettingsFromDisk() || {},
            projectSettings: readPiProjectSettingsFromDisk(cwd) || {},
          })).trim()
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