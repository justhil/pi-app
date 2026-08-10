import { extractTextFromPiMessage, type PiSessionMessage } from '@shared/worker-message'
import { buildTimelinePageFromSessionFile, sessionTimelineError } from '@shared/session-jsonl-timeline'
import { projectTimelineItems } from '@shared/timeline-projection'
import { toolCallDetailFromPi } from '@shared/tool-call-detail'
import { errorMessage } from '@shared/error-message'
import { sessionFilePathsEqual } from '@shared/session-file-path'
import { timelineItemsFromBranchPath } from '../worker-timeline.js'
import type { WorkerIncomingMessage } from '../worker-port-types.js'
import type { WorkerReply } from '../worker-handler-types.js'
import {
  st,
  initSession,
  switchOrLoadSession,
  runtimeNewSession,
  runtimeFork,
  isSessionBusy,
  baseEvent,
  emit,
  currentSessionModelKey,
  listSessions,
} from '../worker-runtime.js'

function currentModelFallbackMessage(): string | undefined {
  const message = String(st.runtime?.modelFallbackMessage || '').trim()
  return message || undefined
}

export async function handleSetmodel(msg: WorkerIncomingMessage, reply: WorkerReply): Promise<void> {
  const provider = String(msg.provider ?? '')
  const modelId = String(msg.modelId ?? '')
  if (!st.session) {
    reply({ type: 'error', error: 'Worker session not started' })
    return
  }
  try {
    const model = st.modelRuntime?.getModel(provider, modelId)
    if (!model) {
      reply({ type: 'error', error: `MODEL_NOT_FOUND: ${provider}/${modelId}` })
      return
    }
    await st.session.setModel(model as Parameters<typeof st.session.setModel>[0])
    const actualModel = currentSessionModelKey()
    if (actualModel !== `${provider}/${modelId}`) {
      reply({ type: 'error', error: `MODEL_NOT_CONFIRMED: ${actualModel || 'unknown'}` })
      return
    }
    emit({ ...baseEvent(), type: 'run', phase: 'state', model: actualModel, thinkingLevel: st.session.thinkingLevel })
    reply({ type: 'setModel-done', modelId: actualModel })
  } catch (e: unknown) {
    const message = errorMessage(e)
    console.error('[Worker] setModel failed:', e)
    reply({ type: 'error', error: message })
  }
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
        try {
          if (isSessionBusy()) {
            reply({ type: 'error', error: 'SESSION_BUSY' })
            return
          }
          if (st.promptSent || st.runtime) {
            const result = await runtimeNewSession()
            if (result.cancelled) {
              reply({ type: 'error', error: 'SESSION_NEW_CANCELLED' })
              return
            }
          } else {
            await initSession(st.currentCwd || process.cwd())
          }
          st.promptSent = false
          reply({
            type: 'newSession-done',
            sessionId: st.currentSessionId,
            sessionFile: st.session?.sessionFile,
          })
        } catch (e: unknown) {
          reply({ type: 'error', error: `newSession failed: ${errorMessage(e)}` })
        }
        return
}


export async function handleListsessions(msg: WorkerIncomingMessage, reply: WorkerReply): Promise<void> {
        const sessions = await listSessions(msg.cwd || st.currentCwd)
        reply({ type: 'listSessions-done', sessions })
        return
}


function applyLeafOverrideToLiveSession(leafId: string | null | undefined): void {
  if (leafId === undefined || !st.session) return
  try {
    const sm = st.session.sessionManager
    if (leafId === null) {
      sm.resetLeaf?.()
    } else if (typeof leafId === 'string' && leafId.length > 0) {
      // branch() only moves the in-memory tip; agent messages must follow.
      sm.branch(leafId)
    }
    const ctx = sm.buildSessionContext?.()
    if (ctx?.messages && st.session.agent?.state) {
      st.session.agent.state.messages = ctx.messages
    }
  } catch (e) {
    console.error('[Worker] applyLeafOverride failed:', e)
  }
}

export async function handleLoadsession(msg: WorkerIncomingMessage, reply: WorkerReply): Promise<void> {
        try {
          const targetFile = msg.sessionFile as string
          const force = msg.force === true
          const leafOverride =
            typeof msg.leafId === 'string'
              ? msg.leafId
              : msg.leafId === null
                ? null
                : undefined
          // Path-normalize: UI / pool keys often differ by slash or drive case from pi's sessionFile.
          // Strict === caused dispose+reopen thrash and worker-exit during rewind.
          if (st.session && sessionFilePathsEqual(st.session.sessionFile, targetFile)) {
            applyLeafOverrideToLiveSession(leafOverride)
            const modelStr = currentSessionModelKey()
            reply({
              type: 'loadSession-done',
              sessionId: st.currentSessionId,
              model: modelStr,
              thinkingLevel: st.session.thinkingLevel,
              leafId: st.session.sessionManager.getLeafId?.() ?? null,
              modelFallbackMessage: currentModelFallbackMessage(),
            })
            return
          }
          const busy =
            !force &&
            st.session &&
            isSessionBusy() &&
            st.session.sessionFile &&
            !sessionFilePathsEqual(st.session.sessionFile, targetFile)
          if (busy) {
            reply({
              type: 'error',
              error: 'WORKER_AGENT_BUSY',
              busySessionFile: st.session!.sessionFile,
            })
            return
          }
          st.agentTurnActive = false
          await switchOrLoadSession(String(msg.sessionFile ?? ''), leafOverride)
          st.promptSent = true
          const modelStr = currentSessionModelKey()
          reply({
            type: 'loadSession-done',
            sessionId: st.currentSessionId,
            model: modelStr,
            thinkingLevel: st.session?.thinkingLevel,
            leafId: st.session?.sessionManager.getLeafId?.() ?? null,
            modelFallbackMessage: currentModelFallbackMessage(),
          })
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
          if (st.session && sessionFilePathsEqual(st.session.sessionFile, file)) {
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
          // 先删文件：让删除动作立即生效（不阻塞在 runtime 重建上）
          if (fs.existsSync(file)) await fs.promises.unlink(file)
          if (st.session && sessionFilePathsEqual(st.session.sessionFile, file)) {
            await initSession(st.currentCwd)
          }
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
        if (isSessionBusy()) {
          reply({ type: 'error', error: 'SESSION_BUSY' })
          return
        }
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



/** TUI /fork — new session file from user entry (position: before). */
export async function handleFork(msg: WorkerIncomingMessage, reply: WorkerReply): Promise<void> {
  try {
    if (!st.session || !st.runtime) {
      reply({ type: 'error', error: 'No session' })
      return
    }
    if (isSessionBusy()) {
      reply({ type: 'error', error: 'SESSION_BUSY' })
      return
    }
    const entryId = String(msg.entryId || msg.fromMessageId || '').trim()
    if (!entryId) {
      reply({ type: 'error', error: 'missing entryId' })
      return
    }
    const position =
      msg.position === 'at' || msg.position === 'before' ? (msg.position as 'at' | 'before') : 'before'
    const result = await runtimeFork(entryId, { position })
    if (result.cancelled) {
      reply({
        type: 'fork-done',
        cancelled: true,
        sessionId: st.currentSessionId,
        sessionFile: st.session?.sessionFile,
      })
      return
    }
    st.promptSent = true
    reply({
      type: 'fork-done',
      cancelled: false,
      sessionId: st.currentSessionId,
      sessionFile: st.session?.sessionFile,
      editorText: result.selectedText,
      model: currentSessionModelKey(),
      thinkingLevel: st.session?.thinkingLevel,
    })
  } catch (e: unknown) {
    reply({ type: 'error', error: `fork failed: ${errorMessage(e)}` })
  }
}

/** TUI /clone — fork(leafId, { position: 'at' }). */
export async function handleClone(_msg: WorkerIncomingMessage, reply: WorkerReply): Promise<void> {
  try {
    if (!st.session || !st.runtime) {
      reply({ type: 'error', error: 'No session' })
      return
    }
    if (isSessionBusy()) {
      reply({ type: 'error', error: 'SESSION_BUSY' })
      return
    }
    const leafId = st.session.sessionManager.getLeafId?.()
    if (!leafId) {
      reply({ type: 'error', error: 'nothing_to_clone' })
      return
    }
    const result = await runtimeFork(leafId, { position: 'at' })
    if (result.cancelled) {
      reply({
        type: 'clone-done',
        cancelled: true,
        sessionId: st.currentSessionId,
        sessionFile: st.session?.sessionFile,
      })
      return
    }
    st.promptSent = true
    reply({
      type: 'clone-done',
      cancelled: false,
      sessionId: st.currentSessionId,
      sessionFile: st.session?.sessionFile,
      model: currentSessionModelKey(),
      thinkingLevel: st.session?.thinkingLevel,
    })
  } catch (e: unknown) {
    reply({ type: 'error', error: `clone failed: ${errorMessage(e)}` })
  }
}

export async function handleGetforkmessages(_msg: WorkerIncomingMessage, reply: WorkerReply): Promise<void> {
  try {
    if (!st.session) {
      reply({ type: 'getForkMessages-done', messages: [] })
      return
    }
    const messages = st.session.getUserMessagesForForking?.() ?? []
    reply({ type: 'getForkMessages-done', messages })
  } catch (e: unknown) {
    reply({ type: 'error', error: `getForkMessages failed: ${errorMessage(e)}` })
  }
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
          // Prefer explicit leaf after navigateTree; else live session leaf when same file.
          let leafId: string | null | undefined =
            typeof msg.leafId === 'string'
              ? msg.leafId
              : msg.leafId === null
                ? null
                : undefined
          if (
            leafId === undefined &&
            st.session &&
            sessionFilePathsEqual(st.session.sessionFile, sessionFile)
          ) {
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
          reply({
            type: 'getMessages-done',
            ...page,
            sourceCount: page.items.length,
            items,
          })
        } catch (e: unknown) {
          reply({ type: 'error', error: sessionTimelineError(e) })
        }
        return
}

