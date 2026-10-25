import { test, expect } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { launchAgentApp, listen, startScriptedModel, type Seen } from './helpers/scripted-agent'

// Smallest real PNG: the renderer only needs decodable bytes for an `img` data URL.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

const readThumb = (
  win: import('@playwright/test').Page,
  file: string,
): Promise<{ ok: boolean }> =>
  win.evaluate(
    (p) =>
      (
        window as unknown as {
          __piE2E: { ipcClient: { invoke: (c: string, a: unknown) => Promise<{ ok: boolean }> } }
        }
      ).__piE2E.ipcClient.invoke('clipboard.readTempImage', { path: p }),
    file,
  )

test('a pasted image renders as a picture in the sent bubble and survives the prune', async () => {
  const seen: Seen[] = []
  const server = startScriptedModel(() => ({ text: 'ok' }), seen)
  const port = await listen(server)
  const app = await launchAgentApp(port)
  const userData = path.join(app.home, '.config', 'Electron')
  try {
    const editor = app.win.locator('[contenteditable="true"]').last()
    await editor.click()
    await app.win.evaluate((b64) => {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
      const dt = new DataTransfer()
      dt.items.add(new File([bytes], 'shot.png', { type: 'image/png' }))
      const el = document.querySelectorAll('[contenteditable="true"]')
      el[el.length - 1].dispatchEvent(
        new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }),
      )
    }, PNG.toString('base64'))

    const tile = app.win.locator('[data-composer-shell] img[src^="data:image/"]')
    await expect(tile).toHaveCount(1, { timeout: 15_000 })

    await app.win.keyboard.type('what is this')
    await app.win.keyboard.press('Enter')
    await expect.poll(() => seen.length, { timeout: 45_000 }).toBeGreaterThan(0)

    // The point of the feature: the bubble shows the picture, not a path.
    const bubbleImage = app.win.locator('.timeline-user-images img[src^="data:image/"]')
    await expect(bubbleImage).toHaveCount(1, { timeout: 15_000 })
    await expect(app.win.locator('.timeline-user-bubble')).not.toContainText('pi-clipboard-')

    // Clicking the picture must open the in-app preview, not the OS viewer.
    await app.win.locator('.timeline-user-images button').first().click()
    await expect(app.win.locator('[role="dialog"]')).toHaveCount(1, { timeout: 5_000 })
    await app.win.keyboard.press('Escape')
    await expect(app.win.locator('[role="dialog"]')).toHaveCount(0, { timeout: 5_000 })

    const clipboardDir = path.join(userData, 'clipboard-images')
    const [tempFile] = fs.readdirSync(clipboardDir).map((n) => path.join(clipboardDir, n))
    expect(await readThumb(app.win, tempFile)).toMatchObject({ ok: true })

    // What the 7-day prune does: the temp file goes away, the bubble keeps its bytes.
    fs.rmSync(tempFile)
    expect(await readThumb(app.win, tempFile)).toMatchObject({ ok: true })

  } finally {
    await app.close()
  }
})

test('an image attached from outside the clipboard dir renders in the sent bubble', async () => {
  const seen: Seen[] = []
  const server = startScriptedModel(() => ({ text: 'ok' }), seen)
  const port = await listen(server)
  const app = await launchAgentApp(port)
  const userData = path.join(app.home, '.config', 'Electron')
  try {
    const dir = path.join(app.home, 'Downloads')
    fs.mkdirSync(dir, { recursive: true })
    const picked = path.join(dir, 'K DP.png')
    fs.writeFileSync(picked, PNG)

    await app.win.evaluate(
      (file) =>
        window.dispatchEvent(
          new CustomEvent('pi-desktop:composer-attach-files', { detail: { files: [file] } }),
        ),
      { path: picked, name: 'K DP.png' },
    )
    await app.send('see this')
    await expect.poll(() => seen.length, { timeout: 45_000 }).toBeGreaterThan(0)

    const bubbleImage = app.win.locator('.timeline-user-images img[src^="data:image/"]')
    await expect(bubbleImage).toHaveCount(1, { timeout: 15_000 })

    const blobs = fs.readdirSync(path.join(userData, 'attachments'))
    expect(blobs).toHaveLength(1)
    expect(fs.readFileSync(path.join(userData, 'attachments', blobs[0]))).toEqual(PNG)
    fs.rmSync(picked)
    expect(await readThumb(app.win, picked)).toMatchObject({ ok: true })
  } finally {
    await app.close()
  }
})
