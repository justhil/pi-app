// Electron main for render.mjs (copied into the render work dir as main.mjs).
import { app, BrowserWindow } from 'electron'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const jobs = JSON.parse(readFileSync('jobs.json', 'utf8'))
// Jobs run one window at a time; closing the last window must not quit the app.
app.on('window-all-closed', () => {})

async function capture(win, job) {
  const { data } = await win.webContents.debugger.sendCommand('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: true,
    clip: { x: 0, y: 0, width: job.width, height: job.height, scale: 1 },
  })
  return Buffer.from(data, 'base64')
}

app.whenReady().then(async () => {
  try {
    for (const job of jobs) {
      const win = new BrowserWindow({ width: job.width, height: job.height, show: false, webPreferences: { offscreen: { deviceScaleFactor: job.scale } } })
      win.setBounds({ x: 0, y: 0, width: job.width, height: job.height })
      await win.loadFile(join(job.dir, 'page.html'))
      await win.webContents.executeJavaScript(`Promise.all([document.fonts.ready, ...[...document.images].map((img) => img.decode().catch(() => {}))]).then(() => window.ready?.())`)
      await new Promise((resolve) => setTimeout(resolve, 400))
      win.webContents.debugger.attach('1.3')
      if (!job.frames) {
        writeFileSync(job.out, await capture(win, job))
      } else {
        mkdirSync(job.out, { recursive: true })
        const times = []
        for (let i = 0; i < job.frames; i++) {
          await win.webContents.executeJavaScript(`window.renderFrame(${i / (job.frames - 1)})`)
          const name = `f${String(i).padStart(4, '0')}.png`
          writeFileSync(join(job.out, name), await capture(win, job))
          times.push([name, i * job.frameMs])
        }
        writeFileSync(join(job.out, 'times.json'), JSON.stringify(times))
      }
      win.destroy()
    }
  } catch (error) {
    console.error(error)
    app.exit(1)
    return
  }
  app.quit()
})
