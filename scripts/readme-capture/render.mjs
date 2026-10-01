// Render HTML templates from renders/ to PNG (or animation frames) in one offscreen Electron run.
// A template reads window.__DATA__ (written to data.js) and resolves assets next to page.html.
// Animated templates expose window.renderFrame(t) for t in [0, 1].
import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { electronBinary, electronFlags } from './app.mjs'
import { REPO } from './config.mjs'

const RENDERS = join(REPO, 'scripts/readme-capture/renders')

/**
 * @typedef {{
 *   template: string,              // file name under renders/
 *   data: Record<string, unknown>, // exposed as window.__DATA__
 *   assets?: Record<string, string>, // name in page dir → source path
 *   width: number, height: number, scale?: number,
 *   out: string,                   // PNG path, or a frames directory when `frames` is set
 *   frames?: number,               // render an animation: frames + times.json for framesToGif
 *   frameMs?: number,
 * }} RenderJob
 */

/** @param {RenderJob[]} jobs */
export function renderPages(jobs, tmp) {
  const root = join(tmp, 'render')
  rmSync(root, { recursive: true, force: true })
  mkdirSync(root, { recursive: true })
  const manifest = jobs.map((job, i) => {
    const dir = join(root, `job-${i}`)
    mkdirSync(dir, { recursive: true })
    copyFileSync(join(RENDERS, job.template), join(dir, 'page.html'))
    copyFileSync(join(RENDERS, 'base.css'), join(dir, 'base.css'))
    copyFileSync(join(REPO, 'src/renderer/public/fonts/geist-mono/GeistMono-Regular.woff2'), join(dir, 'GeistMono-Regular.woff2'))
    for (const [name, source] of Object.entries(job.assets ?? {})) copyFileSync(source, join(dir, name))
    writeFileSync(join(dir, 'data.js'), `window.__DATA__ = ${JSON.stringify(job.data)}\n`)
    return { dir, width: job.width, height: job.height, scale: job.scale ?? 2, out: job.out, frames: job.frames ?? 0, frameMs: job.frameMs ?? 80 }
  })
  writeFileSync(join(root, 'jobs.json'), JSON.stringify(manifest))
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'readme-render', main: 'main.mjs', type: 'module' }))
  writeFileSync(join(root, 'main.mjs'), readFileSync(new URL('./render-main.mjs', import.meta.url)))
  try {
    // Chromium logs GPU-init noise on stderr in headless mode; show it only when rendering fails.
    execFileSync(electronBinary(), [...electronFlags(), '.'], { cwd: root, stdio: ['ignore', 'inherit', 'pipe'], timeout: 10 * 60_000 })
  } catch (error) {
    process.stderr.write(String(error.stderr ?? ''))
    throw error
  }
  for (const job of manifest) console.log(`  ${job.frames ? `${job.out}/ (${job.frames} frames)` : basename(job.out)}`)
}
