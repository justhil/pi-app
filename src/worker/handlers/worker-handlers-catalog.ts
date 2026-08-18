import { buildSessionContextPreview } from '@shared/session-context-preview'
import { errorMessage } from '@shared/error-message'
import type { SkillCatalogResponse } from '@shared/skill-catalog'
import type { WorkerBuiltinSlashCommand } from '@shared/worker-rpc-types'
import { projectModelCatalog } from '@shared/model-auth-projection'
import type { WorkerCommandRow, WorkerIncomingMessage } from '../worker-port-types.js'
import type { WorkerReply } from '../worker-handler-types.js'
import { st } from '../worker-runtime.js'
import {
  applySkillOverrideChanges,
  getLiveWorkerSkillCatalog,
  transferSkill,
  writeSkillDescription,
} from '../worker-skill-resources.js'

export async function handleReloadmodels(msg: WorkerIncomingMessage, reply: WorkerReply): Promise<void> {
        try {
          if (!st.modelRuntime) {
            reply({ type: 'error', error: 'MODEL_RUNTIME_NOT_READY' })
            return
          }
          await st.modelRuntime.refresh()
          reply({ type: 'reloadModels-done', ok: true })
        } catch (e: unknown) {
          reply({ type: 'error', error: `reloadModels failed: ${errorMessage(e)}` })
        }
        return
}


export async function handleGetmodels(msg: WorkerIncomingMessage, reply: WorkerReply): Promise<void> {
        try {
          const models = st.modelRuntime
            ? await st.modelRuntime.getAvailable()
            : []
          reply({
            type: 'getModels-done',
            models: models.map((m: { id: string; name?: string; provider: string; contextWindow?: number; maxOutput?: number }) => ({
              id: m.id,
              name: m.name || m.id,
              provider: m.provider,
              contextWindow: m.contextWindow || 0,
              maxOutput: m.maxOutput || 0,
              available: true,
            })),
          })
        } catch (e: unknown) {
          reply({ type: 'error', error: `getModels failed: ${errorMessage(e)}` })
        }
        return
}


export async function handleGetmodelsettingssnapshot(msg: WorkerIncomingMessage, reply: WorkerReply): Promise<void> {
  try {
    if (!st.modelRuntime) {
      reply({ type: 'error', error: 'MODEL_RUNTIME_NOT_READY' })
      return
    }
    const models = await st.modelRuntime.getModels()
    reply({
      type: 'getModelSettingsSnapshot-done',
      models: await projectModelCatalog(st.modelRuntime, models),
    })
  } catch (e: unknown) {
    reply({ type: 'error', error: `getModelSettingsSnapshot failed: ${errorMessage(e)}` })
  }
}


export async function handleGetcommands(msg: WorkerIncomingMessage, reply: WorkerReply): Promise<void> {
        // Authoritative command list from the live AgentSession (per docs/tui-replacement-and-adapters.md §2.2)
        const commands: WorkerCommandRow[] = []
        const withSlash = (n: string) => n.startsWith('/') ? n : `/${n}`
        if (st.session) {
          try {
            for (const cmd of st.session.extensionRunner.getRegisteredCommands()) {
              commands.push({
                id: cmd.invocationName,
                name: withSlash(cmd.invocationName),
                description: cmd.description || '',
                category: 'extension',
                source: cmd.sourceInfo,
              })
            }
          } catch (e) { console.error('[Worker] getRegisteredCommands failed:', e) }
          try {
            for (const tpl of st.session.promptTemplates) {
              commands.push({
                id: tpl.name,
                name: withSlash(tpl.name),
                description: tpl.description || '',
                category: 'prompt',
                source: tpl.sourceInfo,
              })
            }
          } catch (e) { console.error('[Worker] promptTemplates failed:', e) }
          try {
            type SkillRow = { name?: string; description?: string; path?: string; filePath?: string; skillPath?: string; source?: string; sourceInfo?: { source?: string } }
            const skills = (st.session.resourceLoader as { getSkills?: () => { skills?: SkillRow[] } }).getSkills?.()
            for (const sk of skills?.skills || []) {
              const sname = sk.name?.startsWith('skill:') ? sk.name : `skill:${sk.name}`
              commands.push({
                id: String(sk.name ?? ''),
                name: withSlash(sname),
                description: sk.description || '',
                category: 'skill',
                source: sk.sourceInfo,
              })
            }
          } catch (e) { console.error('[Worker] getSkills failed:', e) }
        }
        reply({ type: 'getCommands-done', commands, hasSession: !!st.session })
        return
}


export async function handleGetsessioncontextpreview(msg: WorkerIncomingMessage, reply: WorkerReply): Promise<void> {
        try {
          reply({
            type: 'getSessionContextPreview-done',
            preview: buildSessionContextPreview({
              sessionId: st.currentSessionId,
              sessionFile: st.session?.sessionFile || String(msg.sessionFile || ''),
              messages: st.session?.messages,
            }),
          })
        } catch (e: unknown) {
          reply({ type: 'error', error: `getSessionContextPreview failed: ${errorMessage(e)}` })
        }
        return
}


export async function handleGetskillslist(msg: WorkerIncomingMessage, reply: WorkerReply): Promise<void> {
  try {
    const live = getLiveWorkerSkillCatalog()
    const catalog: SkillCatalogResponse = {
      ...live,
      candidates: live.candidates.map(({ nativeFilePath: _nativeFilePath, ...candidate }) => candidate),
    }
    reply({ type: 'getSkillsList-done', catalog })
  } catch (e: unknown) {
    reply({ type: 'error', error: `getSkillsList failed: ${errorMessage(e)}` })
  }
}

export async function handleApplyskilloverrides(msg: WorkerIncomingMessage, reply: WorkerReply): Promise<void> {
  try {
    const changes = Array.isArray(msg.changes) ? msg.changes : []
    const count = applySkillOverrideChanges(
      changes.map((change: unknown) => {
        const row = change as { key?: unknown; enabled?: unknown }
        return { key: String(row.key || ''), enabled: row.enabled !== false }
      }),
    )
    reply({ type: 'applySkillOverrides-done', ok: true, count })
  } catch (e: unknown) {
    reply({ type: 'error', error: `applySkillOverrides failed: ${errorMessage(e)}` })
  }
}

export async function handleWriteskilldescription(msg: WorkerIncomingMessage, reply: WorkerReply): Promise<void> {
  try {
    const description = writeSkillDescription(String(msg.key || ''), String(msg.description || ''))
    reply({ type: 'writeSkillDescription-done', ok: true, description })
  } catch (e: unknown) {
    reply({ type: 'error', error: `writeSkillDescription failed: ${errorMessage(e)}` })
  }
}

export async function handleTransferskill(msg: WorkerIncomingMessage, reply: WorkerReply): Promise<void> {
  try {
    const target = msg.target === 'project' ? 'project' : 'user'
    const mode = msg.mode === 'move' ? 'move' : 'copy'
    reply({ type: 'transferSkill-done', ...transferSkill(String(msg.key || ''), target, mode) })
  } catch (e: unknown) {
    reply({ type: 'error', error: `transferSkill failed: ${errorMessage(e)}` })
  }
}


export async function handleGetprompttemplateslist(msg: WorkerIncomingMessage, reply: WorkerReply): Promise<void> {
        try {
          const prompts: Array<Record<string, unknown>> = []
          if (st.session) {
            for (const tpl of st.session.promptTemplates || []) {
              prompts.push({
                name: tpl.name,
                description: tpl.description || '',
                path: (tpl as { path?: string; filePath?: string }).path || (tpl as { path?: string; filePath?: string }).filePath,
                source: (tpl as { sourceInfo?: { source?: string } }).sourceInfo?.source,
              })
            }
          }
          reply({ type: 'getPromptTemplatesList-done', prompts })
        } catch (e: unknown) {
          reply({ type: 'error', error: `getPromptTemplatesList failed: ${errorMessage(e)}` })
        }
        return
}


export async function handleGetcontextprompts(msg: WorkerIncomingMessage, reply: WorkerReply): Promise<void> {
        try {
          const rl = st.session?.resourceLoader
          const agentsFiles = rl?.getAgentsFiles?.()?.agentsFiles ?? []
          const systemPromptFile = rl?.getSystemPrompt?.() ?? undefined
          const appendParts = rl?.getAppendSystemPrompt?.() ?? []
          const builtSystemPreview = st.session?.systemPrompt?.slice(0, 12000) ?? ''
          reply({
            type: 'getContextPrompts-done',
            agentsFiles,
            systemPromptFile: systemPromptFile ?? null,
            appendSystemPromptParts: appendParts,
            builtSystemPreview,
            projectTrusted: st.session?.settingsManager?.isProjectTrusted?.() ?? true,
          })
        } catch (e: unknown) {
          reply({ type: 'error', error: `getContextPrompts failed: ${errorMessage(e)}` })
        }
        return
}


export async function handleReloadresources(msg: WorkerIncomingMessage, reply: WorkerReply): Promise<void> {
        try {
          if (st.session) {
            await (st.session as { reload?: () => Promise<void> }).reload?.()
          }
          reply({ type: 'reloadResources-done', ok: true })
        } catch (e: unknown) {
          reply({ type: 'error', error: `reloadResources failed: ${errorMessage(e)}` })
        }
        return
}

/**
 * 读取生效 SDK 的内置斜杠命令清单（BUILTIN_SLASH_COMMANDS）。
 * 优先从当前 activeSdkPath 同目录的 core/slash-commands.js 导入，
 * 失败时回退到本包内置 SDK —— 保证与 worker 实际加载的 pi 版本一致。
 */
async function loadBuiltinSlashCommands(): Promise<{
  builtins: WorkerBuiltinSlashCommand[]
  source: string
}> {
  const candidates: string[] = []
  // 主路径：当前生效 SDK（含全局/用户 SDK）；文件 URL 导入可绕过 exports map。
  if (st.activeSdkPath) {
    try {
      const { dirname, join } = await import('node:path')
      const { pathToFileURL } = await import('node:url')
      const coreDir = dirname(st.activeSdkPath)
      candidates.push(pathToFileURL(join(coreDir, 'core/slash-commands.js')).href)
    } catch (e: unknown) {
      console.error('[Worker] resolve builtin slash commands path failed:', errorMessage(e))
    }
  }
  // 回退：内置 SDK（activeSdkPath 为空时 worker 用裸导入加载内置包）。
  // 注意：不能直接 import 包子路径——exports map 会拦（ERR_PACKAGE_PATH_NOT_EXPORTED），
  // 必须经 import.meta.resolve 拿到入口文件再拼 core/slash-commands.js。
  try {
    const { dirname, join } = await import('node:path')
    const { fileURLToPath, pathToFileURL } = await import('node:url')
    const entry = import.meta.resolve('@earendil-works/pi-coding-agent')
    const entryPath = fileURLToPath(entry)
    candidates.push(pathToFileURL(join(dirname(entryPath), 'core/slash-commands.js')).href)
  } catch (e: unknown) {
    console.error('[Worker] resolve builtin package entry failed:', errorMessage(e))
  }
  for (const c of candidates) {
    try {
      const mod = (await import(c)) as { BUILTIN_SLASH_COMMANDS?: WorkerBuiltinSlashCommand[] }
      if (Array.isArray(mod?.BUILTIN_SLASH_COMMANDS)) {
        const builtins = mod.BUILTIN_SLASH_COMMANDS.map((b) => ({
          name: b.name,
          description: b.description,
          ...(b.argumentHint ? { argumentHint: b.argumentHint } : {}),
        }))
        return { builtins, source: c }
      }
    } catch (e: unknown) {
      console.error('[Worker] import builtin slash commands failed:', c, errorMessage(e))
    }
  }
  return { builtins: [], source: 'none' }
}

export async function handleGetbuiltins(_msg: WorkerIncomingMessage, reply: WorkerReply): Promise<void> {
  try {
    const { builtins, source } = await loadBuiltinSlashCommands()
    reply({ type: 'getBuiltins-done', builtins, source })
  } catch (e: unknown) {
    reply({ type: 'error', error: `getBuiltins failed: ${errorMessage(e)}` })
  }
  return
}


export async function handleGetcommandcompletions(msg: WorkerIncomingMessage, reply: WorkerReply): Promise<void> {
        try {
          const items: unknown[] = []
          if (st.session) {
            const cmd = st.session.extensionRunner.getCommand(String(msg.commandName ?? ''))
            if (cmd?.getArgumentCompletions) {
              const result = await cmd.getArgumentCompletions(msg.argumentPrefix || '')
              if (Array.isArray(result)) items.push(...result)
            }
          }
          reply({ type: 'getCommandCompletions-done', items })
        } catch (e: unknown) {
          reply({ type: 'getCommandCompletions-done', items: [], error: errorMessage(e) })
        }
        return
}


export async function handleGetstate(msg: WorkerIncomingMessage, reply: WorkerReply): Promise<void> {
        reply({
          type: 'getState-done',
          state: st.session
            ? {
                sessionId: st.session.sessionId,
                sessionName: st.session.sessionName,
                model: (() => {
                  const m = st.session.model as { provider?: string; modelId?: string } | null
                  if (!m?.provider || !m?.modelId) return undefined
                  const id = String(m.modelId)
                  if (!id || id === 'undefined') return undefined
                  return `${m.provider}/${id}`
                })(),
                thinkingLevel:
                  st.session.thinkingLevel != null && String(st.session.thinkingLevel).trim()
                    ? String(st.session.thinkingLevel)
                    : undefined,
                isStreaming: st.session.isStreaming || st.agentTurnActive,
                sessionFile: st.session.sessionFile,
                leafId: st.session.sessionManager.getLeafId?.() ?? null,
                messageCount: st.session.messages.length,
                tools: (((st.session.agent as unknown as { _state?: { tools?: Array<{ name?: string; description?: string }> } })._state?.tools) || []).map((t) => ({
                  name: t.name,
                  description: t.description,
                })),
              }
            : null,
        })
        return
}

