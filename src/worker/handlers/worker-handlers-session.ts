import type { AgentSessionEvent } from '@earendil-works/pi-coding-agent'
import { resolveModelFromRegistry, type PiModelRegistryLike } from '@shared/pi-model-registry'
import { extractTextFromPiMessage, type PiSessionMessage } from '@shared/worker-message'
import { buildTimelinePageFromSessionFile, sessionTimelineError } from '@shared/session-jsonl-timeline'
import { projectTimelineItems } from '@shared/timeline-projection'
import { toolCallDetailFromPi } from '@shared/tool-call-detail'
import { errorMessage } from '@shared/error-message'
import { timelineItemsFromBranchPath } from '../worker-timeline.js'
import type { WorkerIncomingMessage } from '../worker-port-types.js'
import type { WorkerReply } from '../worker-handler-types.js'
import { st, initSession, bindDesktopExtensions, baseEvent, emit, currentSessionModelKey, listSessions, handleSessionEvent } from '../worker-runtime.js'

export async function handleSetmodel(msg: WorkerIncomingMessage, reply: WorkerReply): Promise<void> {
        if (st.session) {
          try {
            // Resolve model from the st.session's modelRegistry (no dynamic pi-ai import — it's a nested dep not hoisted).
            const model = resolveModelFromRegistry(st.session.modelRegistry as PiModelRegistryLike, String(msg.provider ?? ''), String(msg.modelId ?? ''))
            if (model) await st.session.setModel(model as Parameters<typeof st.session.setModel>[0])
            const modelStr = currentSessionModelKey()
            emit({ ...baseEvent(), type: 'run', phase: 'state', model: modelStr, thinkingLevel: st.session.thinkingLevel })
          } catch (e) { console.error('[Worker] setModel failed:', e) }
        }
        reply({ type: 'setModel-done' })
        return
}


export async function handleSetthinkinglevel(msg: WorkerIncomingMessage, reply: WorkerReply): Promise<void> {
        st.session?.setThinkingLevel(msg.level as Parameters<NonNullable<typeof st.session>['setThinkingLevel']>[0])
        if (st.session) {
          const modelStr = currentSessionModelKey()
          emit({ ...baseEvent(), type: 'run', phase: 'state', model: modelStr, thinkingLevel: st.session.thinkingLevel })
        }
        reply({ type: 'setThinkingLevel-done' })
        return
}


export async function handleNewsession(msg: WorkerIncomingMessage, reply: WorkerReply): Promise<void> {
        if (st.promptSent) {
          if (st.unsubscribe) { st.unsubscribe(); st.unsubscribe = null }
          if (st.session) { st.session.dispose(); st.session = null }
          await initSession(st.currentCwd)
        }
        st.promptSent = false
        reply({ type: 'newSession-done', sessionId: st.currentSessionId })
        return
}


export async function handleListsessions(msg: WorkerIncomingMessage, reply: WorkerReply): Promise<void> {
        const sessions = await listSessions(msg.cwd || st.currentCwd)
        reply({ type: 'listSessions-done', sessions })
        return
}


export async function handleLoadsession(msg: WorkerIncomingMessage, reply: WorkerReply): Promise<void> {
        try {
          const targetFile = msg.sessionFile as string
          const force = msg.force === true
          if (st.session?.sessionFile === targetFile) {
            const modelStr = currentSessionModelKey()
            reply({
              type: 'loadSession-done',
              sessionId: st.currentSessionId,
              model: modelStr,
              thinkingLevel: st.session.thinkingLevel,
            })
            return
          }
          const busy =
            !force &&
            st.session &&
            (st.agentTurnActive || st.session.isStreaming) &&
            st.session.sessionFile &&
            st.session.sessionFile !== targetFile
          if (busy) {
            reply({
              type: 'error',
              error: 'WORKER_AGENT_BUSY',
              busySessionFile: st.session!.sessionFile,
            })
            return
          }
          st.agentTurnActive = false
          if (st.unsubscribe) { st.unsubscribe(); st.unsubscribe = null }
          st.session?.dispose()
          const agentDir = st.sdk!.getAgentDir()
          const settingsManager = st.sdk!.SettingsManager.create(st.currentCwd, agentDir)
          const resourceLoader = new st.sdk!.DefaultResourceLoader({
            cwd: st.currentCwd,
            agentDir,
            settingsManager,
            eventBus: st.sharedEventBus!,
          })
          await resourceLoader.reload()
          const sm = st.sdk!.SessionManager.open(String(msg.sessionFile ?? ''))
          const { session: newSession } = await st.sdk!.createAgentSession({
            cwd: st.currentCwd,
            agentDir,
            settingsManager,
            resourceLoader,
            sessionManager: sm,
          })
          st.session = newSession
          st.currentSessionId = st.session.sessionId
          await bindDesktopExtensions(st.session)
          st.promptSent = true
          st.unsubscribe = st.session.subscribe((event: AgentSessionEvent) => handleSessionEvent(event))
          const modelStr = currentSessionModelKey()
          emit({ ...baseEvent(), type: 'run', phase: 'state', model: modelStr, thinkingLevel: st.session.thinkingLevel })
          reply({ type: 'loadSession-done', sessionId: st.currentSessionId, model: modelStr, thinkingLevel: st.session.thinkingLevel })
        } catch (e: unknown) {
          reply({ type: 'error', error: `loadSession failed: ${errorMessage(e)}` })
        }
        return
}


export async function handleSessionrenamefile(msg: WorkerIncomingMessage, reply: WorkerReply): Promise<void> {
        try {
          const file = msg.sessionFile as string
          const title = String(msg.title || '').trim()
          if (!file || !title) {
            reply({ type: 'sessionRenameFile-done', ok: false, error: 'missing file or title' })
            return
          }
          if (st.session?.sessionFile === file) {
            st.session.setSessionName(title)
          } else {
            const sm = st.sdk!.SessionManager.open(file, undefined, st.currentCwd)
            sm.appendSessionInfo(title)
          }
          reply({ type: 'sessionRenameFile-done', ok: true, title })
        } catch (e: unknown) {
          reply({ type: 'sessionRenameFile-done', ok: false, error: errorMessage(e) })
        }
        return
}


export async function handleSessiondeletefile(msg: WorkerIncomingMessage, reply: WorkerReply): Promise<void> {
        try {
          const file = msg.sessionFile as string
          if (!file) {
            reply({ type: 'sessionDeleteFile-done', ok: false, error: 'missing file' })
            return
          }
          const fs = await import('node:fs')
          if (st.session?.sessionFile === file) {
            if (st.unsubscribe) { st.unsubscribe(); st.unsubscribe = null }
            st.session.dispose()
            st.session = null
            await initSession(st.currentCwd)
          }
          if (fs.existsSync(file)) fs.unlinkSync(file)
          reply({ type: 'sessionDeleteFile-done', ok: true })
        } catch (e: unknown) {
          reply({ type: 'sessionDeleteFile-done', ok: false, error: errorMessage(e) })
        }
        return
}


export async function handleGetsessiontree(msg: WorkerIncomingMessage, reply: WorkerReply): Promise<void> {
        if (!st.session) {
          reply({ type: 'getSessionTree-done', nodes: [], leafId: null })
          return
        }
        try {
          const sm = st.session.sessionManager
          const leafId = sm.getLeafId?.() ?? null
          type FlatNode = {
            id: string
            parentId: string | null
            depth: number
            label?: string
            entryType: string
            timestamp?: string
            isLeaf: boolean
            role?: string
            preview?: string
          }
          const previewFromMsg = (m: PiSessionMessage): string => extractTextFromPiMessage(m).trim().slice(0, 120)
          const flat: FlatNode[] = []
          const walk = (nodes: unknown[], depth: number, parentId: string | null) => {
            for (const n of nodes) {
              const node = n as { entry?: { id?: string; type?: string; timestamp?: string; message?: PiSessionMessage }; label?: string; children?: unknown[] }
              const e = node.entry
              const id = e?.id as string
              if (!id) continue
              const row: FlatNode = {
                id,
                parentId,
                depth,
                label: node.label || undefined,
                entryType: e?.type || 'unknown',
                timestamp: e?.timestamp,
                isLeaf: id === leafId,
              }
              if (e?.type === 'message' && e.message) {
                row.role = e.message.role
                row.preview = previewFromMsg(e.message)
              }
              flat.push(row)
              if (node.children?.length) walk(node.children, depth + 1, id)
            }
          }
          walk(sm.getTree(), 0, null)
          reply({ type: 'getSessionTree-done', nodes: flat, leafId })
        } catch (e: unknown) {
          reply({ type: 'error', error: `getSessionTree failed: ${errorMessage(e)}` })
        }
        return
}


export async function handleNavigatetree(msg: WorkerIncomingMessage, reply: WorkerReply): Promise<void> {
        const navSession = st.session
        if (!navSession) { reply({ type: 'error', error: 'No session' }); return }
        try {
          const navOpts = {
            summarize: msg.summarize === true,
            customInstructions: typeof msg.customInstructions === 'string' ? msg.customInstructions : undefined,
            replaceInstructions: typeof msg.replaceInstructions === 'string' ? msg.replaceInstructions : undefined,
            label: typeof msg.label === 'string' ? msg.label : undefined,
          } as Parameters<typeof navSession.navigateTree>[1]
          const result = await navSession.navigateTree(String(msg.targetId ?? ''), navOpts)
          const leafId = navSession.sessionManager.getLeafId?.() ?? null
          reply({
            type: 'navigateTree-done',
            cancelled: result.cancelled,
            editorText: result.editorText,
            leafId,
            sessionMeta: navSession.model
              ? {
                  model: currentSessionModelKey(),
                  thinkingLevel: navSession.thinkingLevel,
                }
              : { thinkingLevel: navSession.thinkingLevel },
          })
        } catch (e: unknown) {
          reply({ type: 'error', error: `navigateTree failed: ${errorMessage(e)}` })
        }
        return
}


export async function handleRunextensioncommand(msg: WorkerIncomingMessage, reply: WorkerReply): Promise<void> {
        if (!st.session) { reply({ type: 'error', error: 'No st.session' }); return }
        const text = String(msg.text || '').trim()
        if (!text.startsWith('/')) {
          reply({ type: 'error', error: 'Expected slash command' })
          return
        }
        reply({ type: 'runExtensionCommand-done' })
        void (async () => {
          try {
            const sess = st.session!
            const streaming = sess.isStreaming || st.agentTurnActive
            await sess.prompt(
              text,
              streaming ? { streamingBehavior: 'followUp' } : undefined,
            )
          } catch (e: unknown) {
            console.error('[Worker] runExtensionCommand failed:', e)
          }
        })()
        return
}


export async function handleGetmessages(msg: WorkerIncomingMessage, reply: WorkerReply): Promise<void> {
        try {
          const sessionFile = String(msg.sessionFile ?? '')
          let leafId: string | null | undefined
          if (st.session && st.session.sessionFile === sessionFile) {
            leafId = st.session.sessionManager.getLeafId?.() ?? null
          }
          const page = await buildTimelinePageFromSessionFile(
            sessionFile,
            {
              offset: msg.offset,
              limit: msg.limit,
              leafId,
              activeSdkPath: st.activeSdkPath,
            },
            timelineItemsFromBranchPath,
          )
          const projected = projectTimelineItems(page.items as Parameters<typeof projectTimelineItems>[0])
          const items = projected.map((row) => {
            if (row.type !== 'tool-call') return row
            const detail = toolCallDetailFromPi(
              String(row.toolName ?? ''),
              row.toolArgs,
              row.toolOutput,
            )
            return { ...row, toolDetail: detail }
          })
          reply({ type: 'getMessages-done', ...page, items })
        } catch (e: unknown) {
          reply({ type: 'error', error: sessionTimelineError(e) })
        }
        return
}

