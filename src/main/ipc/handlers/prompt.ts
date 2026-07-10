import { workerManager } from '../../worker-manager'
import { ensureWorkerSessionBound } from '../../session-bind-state'
import { normalizeSessionKey } from '../../worker-session-key'
import { registerHandler, registerHandlerWithSchema } from '../registry'
import { writeClipboardTempImage } from '../../clipboard-temp-images'
import { clipboardWriteTempImageSchema, promptTextSchema } from '../schemas'

export function registerPromptHandlers(): void {
  const bindBeforePrompt = async (sessionFile?: string) => {
    await ensureWorkerSessionBound(
      (f, o) =>
        workerManager.loadSession(f, {
          force: o?.force,
          // resolveWorkspaceCwd falls back to configStore currentProject when pool is empty
          cwd: workerManager.resolveWorkspaceCwd() || undefined,
        }),
      { sessionFile },
    )
  }

  /** Path-normalize before compare — UI keys and worker state often differ by slash/case. */
  const workerMatchesSession = async (sessionFile?: string) => {
    if (!sessionFile) return true
    const want = normalizeSessionKey(sessionFile)
    if (!want) return true
    const st = await workerManager.getState(sessionFile).catch(() => null)
    const got = normalizeSessionKey(String((st as { sessionFile?: string } | null)?.sessionFile || ''))
    // getState(sessionFile) returns the requested key with isStreaming:false when no slot —
    // treat "same key, idle" as match so abort still runs (no-op on empty pool).
    if (got && got === want) return true
    // No sessionFile in state but slot exists under want (partial state)
    if (!got) return true
    return got === want
  }

  registerHandlerWithSchema('ipc:prompt.send', promptTextSchema, async (req) => {
    await bindBeforePrompt(req.sessionFile)
    await workerManager.sendPrompt(req.text, req.sessionFile)
    // Keep clipboard images on disk for the agent turn (tools like `read` use the path).
    // Cleanup is TTL/startup prune + optional quit, not immediate delete-on-send.
    return { messageId: `msg-${Date.now()}` }
  })

  registerHandlerWithSchema('ipc:clipboard.writeTempImage', clipboardWriteTempImageSchema, async (req) => {
    const ext =
      req.mimeType === 'image/jpeg'
        ? 'jpg'
        : req.mimeType === 'image/webp'
          ? 'webp'
          : req.mimeType === 'image/gif'
            ? 'gif'
            : req.mimeType === 'image/bmp'
              ? 'bmp'
              : 'png'
    const filePath = writeClipboardTempImage(Buffer.from(req.data, 'base64'), ext)
    return { path: filePath }
  })

  registerHandlerWithSchema('ipc:prompt.steer', promptTextSchema, async (req) => {
    await bindBeforePrompt(req.sessionFile)
    await workerManager.steer(req.text, req.sessionFile)
    return { steered: true }
  })

  registerHandlerWithSchema('ipc:prompt.followUp', promptTextSchema, async (req) => {
    await bindBeforePrompt(req.sessionFile)
    await workerManager.followUp(req.text, req.sessionFile)
    return { messageId: `msg-${Date.now()}` }
  })

  registerHandler('ipc:prompt.abort', async (req) => {
    const sessionFile = req?.sessionFile as string | undefined
    // Always attempt abort for the requested session. Path-normalize match only
    // blocks when getState clearly points at a *different* live session.
    if (sessionFile) {
      const want = normalizeSessionKey(sessionFile)
      const st = await workerManager.getState(sessionFile).catch(() => null)
      const got = normalizeSessionKey(String((st as { sessionFile?: string } | null)?.sessionFile || ''))
      const streaming = !!(st as { isStreaming?: boolean } | null)?.isStreaming
      // Foreign running session — refuse (safety). Idle/missing slot — still abort by key.
      if (got && want && got !== want && streaming) {
        return { aborted: false, ignored: true, reason: 'session_mismatch' }
      }
    }
    try {
      await workerManager.abort(sessionFile)
    } catch (e) {
      // No worker for session: still succeed from UI perspective (already idle).
      console.warn('[IPC] prompt.abort:', e)
      return { aborted: true, noWorker: true }
    }
    // Do not delete clipboard images on abort either — user may re-send the same chip.
    return { aborted: true }
  })

  registerHandler('ipc:prompt.dequeueClearQueue', async (req) => {
    const abort = !!req?.abort
    const currentText = typeof req?.currentText === 'string' ? req.currentText : ''
    const sessionFile = req?.sessionFile as string | undefined
    if (!(await workerMatchesSession(sessionFile))) {
      return { restoredCount: 0, combinedText: currentText, ignored: true }
    }
    const cleared = await workerManager.clearPromptQueue(sessionFile)
    const all = [...(cleared.steering || []), ...(cleared.followUp || [])]
    const queuedText = all.join('\n')
    const combined = [queuedText, currentText.trim()].filter(Boolean).join('\n')
    if (abort) await workerManager.abort(sessionFile)
    return { restoredCount: all.length, combinedText: combined }
  })
}