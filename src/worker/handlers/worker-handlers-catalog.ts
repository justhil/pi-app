import { extractTextFromPiMessage, type PiSessionMessage } from '@shared/worker-message'
import { errorMessage } from '@shared/error-message'
import type { WorkerCommandRow, WorkerIncomingMessage } from '../worker-port-types.js'
import type { WorkerReply } from '../worker-handler-types.js'
import { st } from '../worker-runtime.js'

export async function handleReloadmodels(msg: WorkerIncomingMessage, reply: WorkerReply): Promise<void> {
        try {
          st.session?.modelRegistry?.refresh?.()
          reply({ type: 'reloadModels-done', ok: true })
        } catch (e: unknown) {
          reply({ type: 'error', error: `reloadModels failed: ${errorMessage(e)}` })
        }
        return
}


export async function handleGetmodels(msg: WorkerIncomingMessage, reply: WorkerReply): Promise<void> {
        try {
          const models = st.session
            ? await st.session.modelRegistry.getAvailable()
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
          const lines: string[] = []
          const segments: { index: number; role: string; chars: number; preview: string; label?: string }[] = []
          let msgCount = 0
          let estChars = 0
          if (st.session) {
            for (const m of st.session.messages || []) {
              msgCount++
              const hm = m as PiSessionMessage
              const t = extractTextFromPiMessage(hm)
              estChars += t.length
              const role = hm.role || '?'
              let label: string | undefined
              if (role === 'toolResult' && hm.toolName) label = hm.toolName
              if (role === 'assistant' && Array.isArray(hm.content)) {
                const tools = hm.content
                  .filter((c) => (c as { type?: string }).type === 'toolCall')
                  .map((c) => (c as { toolCall?: { name?: string } }).toolCall?.name)
                  .filter(Boolean)
                if (tools.length) label = tools.join(', ')
              }
              segments.push({
                index: segments.length,
                role,
                chars: t.length,
                preview: t.slice(0, 280),
                label,
              })
              if (lines.length < 12 && t) {
                lines.push(`[${role}] ${t.slice(0, 200)}${t.length > 200 ? '…' : ''}`)
              }
            }
          }
          reply({
            type: 'getSessionContextPreview-done',
            preview: {
              sessionId: st.currentSessionId,
              messageCount: msgCount,
              estimatedChars: estChars,
              snippets: lines,
              segments,
            },
          })
        } catch (e: unknown) {
          reply({ type: 'error', error: `getSessionContextPreview failed: ${errorMessage(e)}` })
        }
        return
}


export async function handleGetskillslist(msg: WorkerIncomingMessage, reply: WorkerReply): Promise<void> {
        try {
          const skills: Array<Record<string, unknown>> = []
          if (st.session) {
            type SkillRow = { name?: string; description?: string; path?: string; filePath?: string; skillPath?: string; source?: string; sourceInfo?: { source?: string } }
            const raw = (st.session.resourceLoader as { getSkills?: () => { skills?: SkillRow[] } }).getSkills?.()
            for (const sk of raw?.skills || []) {
              skills.push({
                name: sk.name,
                description: sk.description || '',
                path: sk.path || sk.filePath || sk.skillPath,
                source: sk.sourceInfo?.source || sk.source,
              })
            }
          }
          reply({ type: 'getSkillsList-done', skills })
        } catch (e: unknown) {
          reply({ type: 'error', error: `getSkillsList failed: ${errorMessage(e)}` })
        }
        return
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

