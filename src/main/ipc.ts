import { BrowserWindow, shell, app } from 'electron'
import { getMainWindow } from './window'
import { workerManager } from './worker-manager'
import { configStore } from './config-store'
import { sqliteIndex } from './sqlite-index'
import { resolveSidePanelState } from './side-panel-registry'
import { readPiInfo, readResourceList } from './pi-info'
import {
  readModelsConfig,
  writeModelsConfig,
  fetchRemoteModelIds,
  modelsCatalogFromConfig,
  readModelsConfigRaw,
} from './pi-models-json'
import {
  listSkillsOnDisk,
  listPromptsOnDisk,
  readTextFileSafe,
  writeTextFileSafe,
  skillStorageKey,
} from './pi-resources-editor'
import {
  getDesktopSkillOverrides,
  isSkillEnabled,
  setSkillEnabledInGlobal,
  applySkillOverridesBatch,
  migrateElectronSkillOverrides,
} from './pi-skill-overrides'
import {
  listAgentsContextFiles,
  listPiBuiltinPromptFiles,
  listPluginInjectedPromptFiles,
  groupPromptCatalog,
  PI_GLOBAL_SYSTEM_MD,
  type PromptCatalogItem,
} from './pi-prompt-catalog'
import { listRevisions, pushRevision, restoreRevision, readRevision } from './resource-revisions'
import { probeExtensions } from '../extension-compat/extension-probe'
import { buildPluginAdapters } from '../extension-compat/plugin-adapters'
import { loadAdapterCatalog, invalidateAdapterCatalog, resolveV2SlashPrefix } from '../extension-compat/adapter-loader'
import {
  mergeSlashCommandLists,
  scanStaticSlashCommands,
  type SlashCatalogCommand,
} from './commands-catalog'
import { listAdapterSidePanelMetas } from '../extension-compat/side-panel-catalog'
import {
  mergeRightPanelCatalog,
  defaultRightPanelPrefsForCatalog,
  normalizeRightPanelPrefs,
  normalizeRightPanelOrder,
  type RightPanelCatalogItem,
} from '@shared/right-panels'
import { readAdapterConfig, writeAdapterConfig, runAdapterAction, fetchFieldOptions } from '../extension-compat/adapter-backend'
import { execSync } from 'child_process'
import { readFileSync, existsSync, readdirSync, statSync } from 'fs'
import { join, basename, dirname, resolve } from 'path'
import { homedir } from 'os'
import { isSandboxWorkspacePath } from './sandbox-workspaces'
import { readGitWorkspaceSnapshot, stageHunks, unstageHunks, commitChanges } from './git-workspace'
import { listMissingRuntimePackages, appendMissingGitPackagesToSettings } from './pi-packages-sync'
import { readSdkStatus, listRegistryVersions, installVersion, switchTo } from './sdk-manager'
import { getAsrProvider } from './asr/registry'
import { registerHandler, sendEvent } from './ipc/registry'
import { getActiveSdkModule } from './ipc/sdk-session'
import { registerDialogHandlers } from './ipc/handlers/dialog'
import { registerWorkspaceFsHandlers } from './ipc/handlers/workspace-fs'
import { registerWorkspaceHandlers } from './ipc/handlers/workspace'
import { registerSessionHandlers } from './ipc/handlers/session'
import { registerPromptHandlers } from './ipc/handlers/prompt'
import { registerSettingsHandlers } from './ipc/handlers/settings'
import { registerWindowControlHandlers } from './ipc/handlers/window-controls'
import { registerModelRuntimeHandlers } from './ipc/handlers/model-runtime'
import { registerExtensionHandlers } from './ipc/handlers/extensions'
import { registerExtensionUiHandlers } from './ipc/handlers/extension-ui'

export { registerHandler, sendEvent } from './ipc/registry'

export function registerAllHandlers(): void {
  registerDialogHandlers()
  registerWorkspaceFsHandlers()
  registerWorkspaceHandlers()
  registerSessionHandlers()
  registerPromptHandlers()
  registerSettingsHandlers()
  registerWindowControlHandlers()
  registerExtensionUiHandlers()
  registerModelRuntimeHandlers()
  registerExtensionHandlers()

  // ── Adapter Layer v2 (doc/adapter-layer-plan.md §6) — generic per-adapter config/action IPC ──
  registerHandler('ipc:adapter.config.get', async (req) => {
    const workspaceId = req.workspaceId || workerManager.cwd || configStore.get('currentProject') || ''
    return { view: readAdapterConfig(req.adapterId, workspaceId) }
  })
  registerHandler('ipc:adapter.config.set', async (req) => {
    const workspaceId = req.workspaceId || workerManager.cwd || configStore.get('currentProject') || ''
    return { view: writeAdapterConfig(req.adapterId, workspaceId, req.patch || {}) }
  })
  registerHandler('ipc:adapter.action.run', async (req) => {
    return runAdapterAction(req.adapterId, req.actionId)
  })
  registerHandler('ipc:adapter.field.options', async (req) => {
    return fetchFieldOptions(req.adapterId, req.fieldKey)
  })
  registerHandler('ipc:adapters.json.catalog', async (req) => {
    if (req?.refresh) invalidateAdapterCatalog()
    const cwd = workerManager.cwd || configStore.get('currentProject') || ''
    return loadAdapterCatalog(cwd)
  })

  registerHandler('ipc:rightPanels.catalog', async () => {
    const cwd = workerManager.cwd || configStore.get('currentProject') || process.cwd()
    const probed = probeExtensions(cwd)
    const installedNames = new Set(probed.flatMap((p) => [p.name, p.packageName].filter(Boolean) as string[]))
    const adapterPanels = listAdapterSidePanelMetas(cwd, installedNames)
    const catalog = mergeRightPanelCatalog(adapterPanels)
    const stored = configStore.get('rightPanelPrefs')
    const prefs = normalizeRightPanelPrefs(stored, catalog)
    const order = normalizeRightPanelOrder(configStore.get('rightPanelOrder'), catalog)
    return {
      catalog,
      adapterPanels,
      prefs,
      order,
      defaultPrefs: defaultRightPanelPrefsForCatalog(catalog, adapterPanels),
    }
  })

  registerHandler('ipc:rightPanels.saveLayout', async (req) => {
    const cwd = workerManager.cwd || configStore.get('currentProject') || process.cwd()
    const probed = probeExtensions(cwd)
    const installedNames = new Set(probed.flatMap((p) => [p.name, p.packageName].filter(Boolean) as string[]))
    const adapterPanels = listAdapterSidePanelMetas(cwd, installedNames)
    const catalog = mergeRightPanelCatalog(adapterPanels)
    const prefs = normalizeRightPanelPrefs(req?.prefs, catalog)
    const order = normalizeRightPanelOrder(req?.order, catalog)
    configStore.setRightPanelLayout(prefs, order)
    return { ok: true, prefs, order }
  })

  registerHandler('ipc:skills.list', async () => {
    const legacy = configStore.getSkillOverrides()
    if (legacy && Object.keys(legacy).length > 0) {
      migrateElectronSkillOverrides(legacy)
      configStore.set('skillOverrides', {})
    }
    const cwd = workerManager.cwd || configStore.get('currentProject') || process.cwd()
    const overrides = getDesktopSkillOverrides()
    const disk = listSkillsOnDisk(cwd)
    let worker: any[] = []
    if (workerManager.isRunning) {
      try {
        worker = await workerManager.getSkillsList()
      } catch (e) {
        console.error('[IPC] skills.list worker failed:', e)
      }
    }
    const byPath = new Map<string, any>()
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
        description: s.description || existing?.description || '',
        path: path || existing?.path,
        source: s.source || existing?.source || 'unknown',
        key,
        enabled: isSkillEnabled(s.name, path || existing?.path, overrides),
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
    if (workerManager.isRunning) {
      await workerManager.reloadResources().catch(() => {})
    }
    return { ok: true, key, enabled: isSkillEnabled(name, path, overrides) }
  })

  registerHandler('ipc:skills.applyOverrides', async (req) => {
    const changes = Array.isArray(req?.changes) ? req.changes : []
    const normalized = changes
      .map((c: any) => ({
        name: String(c?.name || ''),
        path: c?.path ? String(c.path) : undefined,
        enabled: c?.enabled !== false,
      }))
      .filter((c: { name: string; path?: string }) => c.name || c.path)
    applySkillOverridesBatch(normalized)
    // 不 reload Worker：启停只写 global settings，skills.list 由 Main 读 desktopSkillOverrides 合并；
    // session.reload() 会重扫扩展/技能，保存设置时动辄数秒且无必要。
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
      } catch {
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
              source: (t.source as any) || 'unknown',
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
        return {
          content: String(ctx.builtSystemPreview || '（空）'),
          path,
          revisions: [],
        }
      } catch (e: any) {
        return { error: e.message }
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
        } catch {
          /* */
        }
      }
      return { content: seed, path: resolved, revisions: [] }
    }
    try {
      const { content, path: resolvedPath } = readTextFileSafe(path)
      return { content, path: resolvedPath, revisions: listRevisions(resolvedPath) }
    } catch (e: any) {
      return { error: e.message }
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
      if (workerManager.isRunning) {
        await workerManager.reloadResources().catch(() => {})
      }
      return { ok: true, revisions: listRevisions(path) }
    } catch (e: any) {
      return { ok: false, error: e.message }
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
    } catch (e: any) {
      return { ok: false, error: e.message }
    }
  })

  registerHandler('ipc:resource.revision.read', async (req) => {
    try {
      const content = readRevision(String(req.path), String(req.revisionId))
      return { content }
    } catch (e: any) {
      return { error: e.message }
    }
  })

  registerHandler('ipc:commands.completions', async (req) => {
    if (!workerManager.isRunning) return { items: [] }
    try {
      const items = await workerManager.getCommandCompletions(req.commandName, req.argumentPrefix || '')
      return { items }
    } catch (e) {
      console.error('[IPC] commands.completions failed:', e)
      return { items: [] }
    }
  })

  // ── Commands ──
  // Live session list when bound; otherwise disk + extension probe (preview / pendingBind).
  registerHandler('ipc:commands.list', async (_req) => {
    const cwd = workerManager.cwd || configStore.get('currentProject') || process.cwd()
    const overrides = getDesktopSkillOverrides()
    const filterSkills = (list: SlashCatalogCommand[]) =>
      list.filter((c) => {
        if (c.category !== 'skill') return true
        const id = String(c.id || c.name || '').replace(/^\/?skill:/, '')
        const path = c.source?.path || c.source?.filePath
        return isSkillEnabled(id, path, overrides)
      })

    const staticCmds = filterSkills(scanStaticSlashCommands(cwd))

    await workerManager.awaitReady()
    if (workerManager.isRunning) {
      try {
        const r = await workerManager.getCommands()
        const workerCmds = filterSkills((r.commands || []) as SlashCatalogCommand[])
        if (r.hasSession && workerCmds.length > 0) {
          return { commands: mergeSlashCommandLists(workerCmds, staticCmds), source: 'worker' }
        }
        if (workerCmds.length > 0) {
          return { commands: mergeSlashCommandLists(workerCmds, staticCmds), source: 'preview' }
        }
      } catch (e) {
        console.error('[IPC] commands.list worker failed:', e)
      }
    }

    if (staticCmds.length > 0) return { commands: staticCmds, source: 'preview' }
    return { commands: [], source: 'fallback' }
  })

  // ── Review ──
  registerHandler('ipc:review.getDiff', async (req) => {
    const cwd = workerManager.cwd || configStore.get('currentProject') || process.cwd()
    if (req.scope === 'git') {
      const snap = readGitWorkspaceSnapshot(cwd)
      return {
        diff: {
          raw: snap.raw,
          status: snap.status,
          scope: 'git',
          branch: snap.branch,
          log: snap.log,
          isRepo: snap.isRepo,
          message: snap.message,
        },
      }
    }
    return { diff: { raw: '', status: '', scope: req.scope, isRepo: true } }
  })

  registerHandler('ipc:review.stageHunks', async (req) => {
    const cwd = req.cwd || workerManager.cwd || configStore.get('currentProject') || process.cwd()
    const r = stageHunks(cwd, req.files || [])
    return { ok: r.ok, error: r.error }
  })

  registerHandler('ipc:review.unstageHunks', async (req) => {
    const cwd = req.cwd || workerManager.cwd || configStore.get('currentProject') || process.cwd()
    const r = unstageHunks(cwd, req.files || [])
    return { ok: r.ok, error: r.error }
  })

  registerHandler('ipc:review.commit', async (req) => {
    const cwd = req.cwd || workerManager.cwd || configStore.get('currentProject') || process.cwd()
    const r = commitChanges(cwd, req.message || '')
    return { ok: r.ok, error: r.error, commitHash: r.commitHash }
  })

  registerHandler('ipc:adapter.sidePanel.getState', async (req) => {
    const fallback = workerManager.cwd || configStore.get('currentProject') || process.cwd()
    // 右栏状态按「当前打开的项目」读盘，不能只用 Worker cwd（未启动/沙箱时会错目录）
    const cwd = (req.workspaceId && String(req.workspaceId).trim()) || fallback
    const workspaceId = cwd
    const adapterId = String(req.adapterId || '').trim()
    if (!adapterId) return { ok: false, error: 'adapter_id_required', state: null }
    const r = resolveSidePanelState(adapterId, cwd, workspaceId)
    if (!r.ok) return { ok: false, error: r.error, state: null }
    return { ok: true, state: r.state }
  })

  registerHandler('ipc:slash.normalize', async (req) => {
    return { text: String(req.text ?? '').trim() }
  })

  // B-layer: resolve slash command desktop behavior (notify vs config-page vs execute) — v2-only
  registerHandler('ipc:slash.resolve', async (req) => {
    const r = resolveV2SlashPrefix(req.command || '')
    if (!r) return { behavior: 'passthrough', meta: null }
    return {
      behavior: r.behavior,
      meta: {
        matchNames: r.matchNames,
        desktopSupport: r.desktopSupport,
        panelId: r.panelId,
        adapterId: r.adapterId,
      },
    }
  })

  // ── Registry ──
  registerHandler('ipc:registry.refresh', async (req) => {
    // TODO: fetch remote registry
    return { refreshed: false, count: 0 }
  })

  // ── ASR (Voice Input) ──
  registerHandler('ipc:asr.transcribe', async (req) => {
    const raw = (req?.config && typeof req.config === 'object' ? req.config : null) ?? configStore.get('asrConfig')
    const { normalizeAsrConfigForOps } = await import('./asr/asr-config-normalize')
    const cfg = normalizeAsrConfigForOps(raw as import('@shared/asr-types').AsrConfig)
    const provider = getAsrProvider(cfg)
    if (!provider) return { ok: false, error: 'not_configured', kind: 'not_configured' }
    const buf = Buffer.from(req.audio, 'base64')
    const r = await provider.transcribe({
      audio: buf,
      mimeType: req.mimeType,
      language: cfg.language || req.language,
    })
    return r
  })

  registerHandler('ipc:asr.testConnection', async (req) => {
    const raw = (req?.config && typeof req.config === 'object' ? req.config : null) ?? configStore.get('asrConfig')
    const { normalizeAsrConfigForOps } = await import('./asr/asr-config-normalize')
    const cfg = normalizeAsrConfigForOps(raw as import('@shared/asr-types').AsrConfig)
    const provider = getAsrProvider(cfg)
    if (!provider) return { ok: false, detail: 'ASR provider not configured (enable built-in voice in Settings)' }
    return provider.testConnection()
  })

  registerHandler('ipc:asr.probeCodexAuth', async (req) => {
    const { probeCodexAuth } = await import('./asr/codex-auth')
    const cfg = req?.config && typeof req.config === 'object' ? req.config : req
    return probeCodexAuth({
      authFile: cfg?.authFile || cfg?.codexAuthFile ? String(cfg.authFile || cfg.codexAuthFile) : undefined,
      accessToken: cfg?.accessToken || cfg?.codexAccessToken ? String(cfg.accessToken || cfg.codexAccessToken) : undefined,
    })
  })

  registerHandler('ipc:asr.importCodexAccessToken', async (req) => {
    const { importCodexAccessTokenFromFile } = await import('./asr/codex-auth')
    const authFile = req?.authFile || req?.codexAuthFile ? String(req.authFile || req.codexAuthFile) : undefined
    return importCodexAccessTokenFromFile(authFile)
  })

  registerHandler('ipc:asr.builtinStatus', async () => {
    return { running: false, directApi: true, bundledAvailable: false, port: 0 }
  })

  registerHandler('ipc:asr.detectBinary', async () => {
    try {
      const { execSync } = await import('child_process')
      const cmd = process.platform === 'win32' ? 'where codex-asr' : 'which codex-asr'
      const path = execSync(cmd, { encoding: 'utf8', timeout: 5000 }).trim().split('\n')[0].trim()
      return { found: !!path, path: path || null }
    } catch {
      return { found: false, path: null }
    }
  })

  // ── Pi Info ──
  registerHandler('ipc:pi.getInfo', async () => {
    return readPiInfo()
  })

  registerHandler('ipc:pi.models.get', async () => {
    const r = await readModelsConfig()
    return {
      path: r.path,
      config: r.config,
      parseError: r.parseError,
      schemaError: r.schemaError,
      warnings: r.warnings,
    }
  })

  registerHandler('ipc:pi.models.set', async (req) => {
    const config = req?.config
    if (!config?.providers || typeof config.providers !== 'object') {
      return { ok: false, path: '', error: '无效 config' }
    }
    const r = await writeModelsConfig(config)
    if (r.ok && workerManager.isRunning) {
      try {
        await workerManager.reloadModels()
      } catch (e) {
        console.error('[IPC] pi.models.set reloadModels failed:', e)
      }
    }
    return r
  })

  registerHandler('ipc:pi.models.fetch', async (req) => {
    return fetchRemoteModelIds({
      baseUrl: String(req?.baseUrl || ''),
      apiKey: req?.apiKey,
      authHeader: req?.authHeader,
    })
  })

  // ── SDK 升级 / 切换 / 回退 ──
  registerHandler('ipc:sdk.status', async () => {
    const status = readSdkStatus(app.getPath('userData'))
    status.workerFallback = workerManager.lastSdkFallback
    return status
  })

  registerHandler('ipc:sdk.listAvailable', async () => {
    return await listRegistryVersions()
  })

  registerHandler('ipc:sdk.install', async (req) => {
    const version = String(req?.version || '').trim()
    if (!version) return { ok: false, error: 'missing version' }
    const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0]
    try {
      await installVersion(version, (line) => {
        if (win) sendEvent(win, { type: 'sdk-install-progress', version, line })
      })
      if (win) sendEvent(win, { type: 'sdk-install-progress', version, done: true })
      const cwd = workerManager.cwd || configStore.get('currentProject')
      if (cwd) {
        await workerManager.stop()
        await workerManager.start(cwd)
      }
      return { ok: true }
    } catch (e: any) {
      if (win) sendEvent(win, { type: 'sdk-install-progress', version, done: true, error: e.message })
      return { ok: false, error: e.message }
    }
  })

  registerHandler('ipc:sdk.switch', async (req) => {
    const target: 'builtin' | 'global' | 'user' =
      req?.target === 'global' ? 'global' : req?.target === 'user' ? 'user' : 'builtin'
    try {
      await switchTo(target)
      const cwd = workerManager.cwd || configStore.get('currentProject')
      if (cwd) {
        await workerManager.stop()
        await workerManager.start(cwd)
      }
      return { ok: true, active: target }
    } catch (e: any) {
      return { ok: false, error: e.message }
    }
  })

  // ── Pi Settings (A-layer write-back, tui-replacement-and-adapters.md §2.5) ──
  registerHandler('ipc:pi.settings.get', async () => {
    if (workerManager.isRunning) {
      try {
        const settings = await workerManager.getPiSettings()
        return { settings }
      } catch (e: any) {
        return { settings: null, error: e.message }
      }
    }
    const { readPiAgentGlobalSettingsFromDisk } = await import('./pi-agent-settings-read')
    const disk = readPiAgentGlobalSettingsFromDisk()
    if (disk) return { settings: disk, source: 'agent-settings-json' as const }
    return { settings: null, error: 'Worker not started' }
  })

  registerHandler('ipc:pi.settings.set', async (req) => {
    try {
      await workerManager.setPiSettings(req.patch || {})
      return { ok: true }
    } catch (e: any) {
      return { ok: false, error: e.message }
    }
  })

  // ── Resources ──
  registerHandler('ipc:resources.list', async () => {
    const cwd = workerManager.cwd || configStore.get('currentProject') || process.cwd()
    return readResourceList(cwd)
  })
}
