import { test, expect } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { launchAgentApp, listen, startScriptedModel, type Seen } from './helpers/scripted-agent'

// Header bytes only: the store copies bytes verbatim, so a real encoder is not needed.
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex')

test('a sent image keeps its bytes after the temp file is deleted', async () => {
  const seen: Seen[] = []
  const server = startScriptedModel(() => ({ text: 'ok' }), seen)
  const port = await listen(server)
  const app = await launchAgentApp(port)
  const userData = path.join(app.home, '.config', 'Electron')
  try {
    const clipboardDir = path.join(userData, 'clipboard-images')
    fs.mkdirSync(clipboardDir, { recursive: true })
    const image = path.join(clipboardDir, 'pi-clipboard-e2e.png')
    fs.writeFileSync(image, PNG)

    await app.send(`look at ${image}`)
    await expect.poll(() => seen.length, { timeout: 45_000 }).toBeGreaterThan(0)

    const attachments = path.join(userData, 'attachments')
    await expect.poll(() => fs.existsSync(attachments), { timeout: 30_000 }).toBe(true)
    const blobs = fs.readdirSync(attachments)
    expect(blobs).toHaveLength(1)
    expect(fs.readFileSync(path.join(attachments, blobs[0]))).toEqual(PNG)

    // What the 7-day prune does: the path in the message stops resolving, the store answers instead.
    fs.rmSync(image)
    const thumb = await app.win.evaluate(
      (p) => (window as unknown as { __piE2E: { ipcClient: { invoke: (c: string, a: unknown) => Promise<unknown> } } }).__piE2E.ipcClient.invoke('clipboard.readTempImage', { path: p }),
      image,
    )
    expect(thumb).toMatchObject({ ok: true })
    expect(String((thumb as { dataUrl: string }).dataUrl)).toContain(PNG.toString('base64').slice(0, 12))
  } finally {
    await app.close()
  }
})
