import { writeFileSync } from 'fs'
import { tmpdir } from 'node:os'
import { join } from 'path'
import { randomUUID } from 'node:crypto'
import { workerManager } from '../../worker-manager'
import { ensureWorkerSessionBound } from '../../session-bind-state'
import { registerHandler, registerHandlerWithSchema } from '../registry'
import { releaseAllClipboardTempImages, trackClipboardTempImage } from '../../clipboard-temp-images'
import { clipboardWriteTempImageSchema, promptTextSchema } from '../schemas'

export function registerPromptHandlers(): void {
  const bindBeforePrompt = async (sessionFile?: string) => {
    await ensureWorkerSessionBound((f, o) => workerManager.loadSession(f, o), { sessionFile })
  }

  const workerMatchesSession = async (sessionFile?: string) => {
    if (!sessionFile) return true
    const st = await workerManager.getState().catch(() => null)
    return (st as { sessionFile?: string } | null)?.sessionFile === sessionFile
  }

  registerHandlerWithSchema('ipc:prompt.send', promptTextSchema, async (req) => {
    await bindBeforePrompt(req.sessionFile)
    await workerManager.sendPrompt(req.text)
    releaseAllClipboardTempImages()
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
    const filePath = join(tmpdir(), `pi-clipboard-${randomUUID()}.${ext}`)
    writeFileSync(filePath, Buffer.from(req.data, 'base64'))
    trackClipboardTempImage(filePath)
    return { path: filePath }
  })

  registerHandlerWithSchema('ipc:prompt.steer', promptTextSchema, async (req) => {
    await bindBeforePrompt(req.sessionFile)
    await workerManager.steer(req.text)
    return { steered: true }
  })

  registerHandlerWithSchema('ipc:prompt.followUp', promptTextSchema, async (req) => {
    await bindBeforePrompt(req.sessionFile)
    await workerManager.followUp(req.text)
    return { messageId: `msg-${Date.now()}` }
  })

  registerHandler('ipc:prompt.abort', async (req) => {
    if (!(await workerMatchesSession(req?.sessionFile as string | undefined))) {
      return { aborted: false, ignored: true }
    }
    await workerManager.abort()
    releaseAllClipboardTempImages()
    return { aborted: true }
  })

  registerHandler('ipc:prompt.dequeueClearQueue', async (req) => {
    const abort = !!req?.abort
    const currentText = typeof req?.currentText === 'string' ? req.currentText : ''
    if (!(await workerMatchesSession(req?.sessionFile as string | undefined))) {
      return { restoredCount: 0, combinedText: currentText, ignored: true }
    }
    const cleared = await workerManager.clearPromptQueue()
    const all = [...(cleared.steering || []), ...(cleared.followUp || [])]
    const queuedText = all.join('\n')
    const combined = [queuedText, currentText.trim()].filter(Boolean).join('\n')
    if (abort) await workerManager.abort()
    return { restoredCount: all.length, combinedText: combined }
  })
}