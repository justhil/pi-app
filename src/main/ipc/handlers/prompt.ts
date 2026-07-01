import { writeFileSync } from 'fs'
import { tmpdir } from 'node:os'
import { join } from 'path'
import { randomUUID } from 'node:crypto'
import { workerManager } from '../../worker-manager'
import { ensureWorkerSessionBound } from '../../session-bind-state'
import { registerHandler } from '../registry'

export function registerPromptHandlers(): void {
  const bindBeforePrompt = async () => {
    await ensureWorkerSessionBound((f) => workerManager.loadSession(f))
  }

  registerHandler('ipc:prompt.send', async (req) => {
    await bindBeforePrompt()
    await workerManager.sendPrompt(req.text)
    return { messageId: `msg-${Date.now()}` }
  })

  registerHandler('ipc:clipboard.writeTempImage', async (req) => {
    const { data, mimeType } = req
    const ext =
      mimeType === 'image/jpeg'
        ? 'jpg'
        : mimeType === 'image/webp'
          ? 'webp'
          : mimeType === 'image/gif'
            ? 'gif'
            : mimeType === 'image/bmp'
              ? 'bmp'
              : 'png'
    const filePath = join(tmpdir(), `pi-clipboard-${randomUUID()}.${ext}`)
    writeFileSync(filePath, Buffer.from(data, 'base64'))
    return { path: filePath }
  })

  registerHandler('ipc:prompt.steer', async (req) => {
    await bindBeforePrompt()
    await workerManager.steer(req.text)
    return { steered: true }
  })

  registerHandler('ipc:prompt.followUp', async (req) => {
    await bindBeforePrompt()
    await workerManager.followUp(req.text)
    return { messageId: `msg-${Date.now()}` }
  })

  registerHandler('ipc:prompt.abort', async () => {
    await workerManager.abort()
    return { aborted: true }
  })

  registerHandler('ipc:prompt.dequeueClearQueue', async (req) => {
    const abort = !!req?.abort
    const currentText = typeof req?.currentText === 'string' ? req.currentText : ''
    const cleared = await workerManager.clearPromptQueue()
    const all = [...(cleared.steering || []), ...(cleared.followUp || [])]
    const queuedText = all.join('\n')
    const combined = [queuedText, currentText.trim()].filter(Boolean).join('\n')
    if (abort) await workerManager.abort()
    return { restoredCount: all.length, combinedText: combined }
  })
}