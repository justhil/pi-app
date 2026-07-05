import { errorMessage } from '@shared/error-message'
import type { WorkerIncomingMessage } from '../worker-port-types.js'
import type { ExtensionUIResponse } from '../desktop-ui-bridge.js'
import type { WorkerReply } from '../worker-handler-types.js'
import { st, initSession, baseEvent, emit, currentSessionModelKey } from '../worker-runtime.js'

export async function handleInit(msg: WorkerIncomingMessage, reply: WorkerReply): Promise<void> {
        try {
          console.log('[Worker] Initializing st.session for:', msg.cwd)
          st.activeSdkPath = typeof msg.sdkPath === 'string' && msg.sdkPath ? msg.sdkPath : null
          let sdkFallback = false
          try {
            if (st.activeSdkPath) {
              const { isAbsolute } = await import('node:path')
              const { pathToFileURL } = await import('node:url')
              if (isAbsolute(st.activeSdkPath)) {
                st.sdk = await import(pathToFileURL(st.activeSdkPath).href)
              } else {
                st.sdk = await import(st.activeSdkPath)
              }
            } else {
              st.sdk = await import('@earendil-works/pi-coding-agent')
            }
          } catch (e: unknown) {
            console.error('[Worker] Dynamic import SDK failed, fallback to builtin:', errorMessage(e))
            st.activeSdkPath = null
            st.sdk = await import('@earendil-works/pi-coding-agent')
            sdkFallback = true
          }
          if (!st.sdk) throw new Error('SDK load failed')
          if (!st.sharedEventBus) st.sharedEventBus = st.sdk.createEventBus()
          await initSession(String(msg.cwd || ''))
          console.log('[Worker] Init done, sessionId:', st.currentSessionId)
          reply({ type: 'init-done', sessionId: st.currentSessionId, model: currentSessionModelKey(), thinkingLevel: st.session?.thinkingLevel, sdkFallback })
        } catch (e: unknown) {
          console.error('[Worker] Init FAILED:', errorMessage(e), e instanceof Error ? e.stack : '')
          reply({ type: 'error', error: `Init failed: ${errorMessage(e)}`, stack: e instanceof Error ? e.stack : undefined })
        }
        return
}


export async function handlePrompt(msg: WorkerIncomingMessage, reply: WorkerReply): Promise<void> {
        const promptSession = st.session
        if (!promptSession) { reply({ type: 'error', error: 'No session' }); return }
        const promptText = String(msg.text ?? '').trim()
        const slashMatch = promptText.match(/^(\/\S+)/)
        if (slashMatch) {
          emit({
            ...baseEvent(),
            type: 'slash',
            command: slashMatch[1],
            status: 'dispatched',
            text: '已发送给 pi 执行',
          })
        }
        st.promptSent = true
        reply({ type: 'prompt-done' })
        void (async () => {
          try {
            const extra = msg.options as Parameters<typeof promptSession.prompt>[1]
            const streaming = promptSession.isStreaming || st.agentTurnActive
            const merged =
              streaming && !extra?.streamingBehavior
                ? { ...extra, streamingBehavior: 'followUp' as const }
                : extra
            await promptSession.prompt(promptText, merged)
            if (slashMatch) {
              emit({
                ...baseEvent(),
                type: 'slash',
                command: slashMatch[1],
                status: 'ok',
                text: '命令已执行（详见下方助手/工具输出）',
              })
            }
            if (!st.agentTurnActive) {
              emit({ ...baseEvent(), type: 'run', phase: 'idle' })
            }
          } catch (e: unknown) {
            console.error('[Worker] prompt failed:', e)
            const errText = errorMessage(e)
            emit({
              ...baseEvent(),
              type: 'agent_error',
              text: errText,
              kind: 'error',
              stopReason: 'error',
            })
            emit({ ...baseEvent(), type: 'run', phase: 'failed' })
            emit({ ...baseEvent(), type: 'run', phase: 'idle' })
            if (slashMatch) {
              emit({
                ...baseEvent(),
                type: 'slash',
                command: slashMatch[1],
                status: 'error',
                text: `执行失败: ${errText}`,
              })
            }
          }
        })()
        return
}


export async function handleAbort(msg: WorkerIncomingMessage, reply: WorkerReply): Promise<void> {
        const wasActive = st.agentTurnActive
        if (st.session) {
          try {
            st.session.clearQueue()
          } catch (e) {
            console.error('[Worker] clearQueue on abort failed:', e)
          }
        }
        try {
          st.session?.abortRetry?.()
          st.session?.agent?.abort?.()
        } catch (e: unknown) {
          console.error('[Worker] abort failed:', e)
        }
        st.agentTurnActive = false
        if (wasActive) {
          emit({
            ...baseEvent(),
            type: 'agent_error',
            text: 'Request was aborted.',
            kind: 'aborted',
            stopReason: 'aborted',
          })
        }
        emit({ ...baseEvent(), type: 'run', phase: 'idle' })
        reply({ type: 'abort-done' })
        return
}


export async function handleSteer(msg: WorkerIncomingMessage, reply: WorkerReply): Promise<void> {
        await st.session?.steer(String(msg.text ?? ''))
        reply({ type: 'steer-done' })
        return
}


export async function handleFollowup(msg: WorkerIncomingMessage, reply: WorkerReply): Promise<void> {
        if (!st.session) { reply({ type: 'error', error: 'No st.session' }); return }
        reply({ type: 'followUp-done' })
        void st.session.followUp(String(msg.text ?? '')).catch((e: unknown) => {
          console.error('[Worker] followUp failed:', e)
          const errText = errorMessage(e)
          emit({
            ...baseEvent(),
            type: 'agent_error',
            text: errText,
            kind: 'error',
            stopReason: 'error',
          })
          emit({ ...baseEvent(), type: 'run', phase: 'failed' })
          emit({ ...baseEvent(), type: 'run', phase: 'idle' })
        })
        return
}


export async function handleClearqueue(msg: WorkerIncomingMessage, reply: WorkerReply): Promise<void> {
        if (!st.session) { reply({ type: 'clearQueue-done', steering: [], followUp: [] }); return }
        const cleared = st.session.clearQueue()
        reply({ type: 'clearQueue-done', steering: cleared.steering || [], followUp: cleared.followUp || [] })
        return
}


export async function handleExtensionUiResponse(msg: WorkerIncomingMessage, reply: WorkerReply): Promise<void> {
        st.uiBridge?.handleExtensionUIResponse(msg.response as ExtensionUIResponse)
        reply({ type: 'extension-ui-response-done' })
        return
}


export async function handleDispose(msg: WorkerIncomingMessage, reply: WorkerReply): Promise<void> {
        st.uiBridge?.dispose()
        st.uiBridge = null
        if (st.unsubscribe) { st.unsubscribe(); st.unsubscribe = null }
        st.session?.dispose()
        st.session = null
        reply({ type: 'dispose-done' })
        return
}


export async function handlePing(msg: WorkerIncomingMessage, reply: WorkerReply): Promise<void> {
        reply({ type: 'pong' })
        return
}

