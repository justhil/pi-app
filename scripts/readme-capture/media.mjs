// Post-processing: GIFs from timed frames (ffmpeg) and framed/composited PNGs (ImageMagick 7).
import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { electronBinary, electronFlags } from './app.mjs'
import { BACKGROUND, CROPS, PANELS, REPO, VIEWPORT } from './config.mjs'

const run = (cmd, args) => execFileSync(cmd, args, { stdio: ['ignore', 'ignore', 'inherit'] })
const magick = (...args) => run('magick', args.flat())
const kb = (file) => `${Math.round(statSync(file).size / 1024)} KB`
const px = (value) => value * VIEWPORT.scale
const cropArg = ({ x, y, width, height }) => `${px(width)}x${px(height)}+${px(x)}+${px(y)}`

export function checkTools() {
  for (const [cmd, args] of [['magick', ['-version']], ['ffmpeg', ['-version']], ['git', ['--version']]]) {
    try {
      execFileSync(cmd, args, { stdio: 'ignore' })
    } catch {
      throw new Error(`readme-capture: "${cmd}" is required on PATH (ImageMagick 7, ffmpeg, git)`)
    }
  }
}

/** Frames + times.json → GIF that replays at capture speed; the last frame holds for 2.5s. */
export function framesToGif({ framesDir, out, width, crop }) {
  const times = JSON.parse(readFileSync(join(framesDir, 'times.json'), 'utf8'))
  const lines = times.flatMap(([name, at], i) => {
    const next = i + 1 < times.length ? times[i + 1][1] : at + 2500
    const seconds = Math.max(0.04, Math.min((next - at) / 1000, 2.5))
    return [`file '${resolve(framesDir, name)}'`, `duration ${seconds.toFixed(3)}`]
  })
  lines.push(`file '${resolve(framesDir, times.at(-1)[0])}'`)
  const list = join(framesDir, 'concat.txt')
  writeFileSync(list, `${lines.join('\n')}\n`)
  const filters = [
    ...(crop ? [`crop=${px(crop.width)}:${px(crop.height)}:${px(crop.x)}:${px(crop.y)}`] : []),
    `scale=${width}:-1:flags=lanczos`,
    'fps=12',
    'split[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=none:diff_mode=rectangle',
  ]
  run('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', list, '-vf', filters.join(','), '-loop', '0', out])
  console.log(`  ${out} (${kb(out)})`)
}

function roundCorners(input, output, radius) {
  magick(input,
    '(', '+clone', '-alpha', 'extract', '-draw', `fill black polygon 0,0 0,${radius} ${radius},0 fill white circle ${radius},${radius} ${radius},0`,
    '(', '+clone', '-flip', ')', '-compose', 'Multiply', '-composite',
    '(', '+clone', '-flop', ')', '-compose', 'Multiply', '-composite', ')',
    '-alpha', 'off', '-compose', 'CopyOpacity', '-composite', output)
}

const PNG_OUT = ['-strip', '-depth', '8', '-define', 'png:compression-level=9']

/** Full window on a soft brand gradient with a drop shadow. */
export function framedHero({ input, out, theme, tmp }) {
  const [top, bottom, shadow] = BACKGROUND[theme]
  const rounded = join(tmp, 'hero-rounded.png')
  const shadowed = join(tmp, 'hero-shadow.png')
  roundCorners(input, rounded, 22)
  magick(rounded, '(', '+clone', '-background', shadow, '-shadow', '38x46+0+30', ')', '+swap', '-background', 'none', '-layers', 'merge', '+repage', shadowed)
  const [w, h] = execFileSync('magick', ['identify', '-format', '%w %h', shadowed]).toString().split(' ').map(Number)
  magick('-size', `${w + 200}x${h + 160}`, `gradient:${top}-${bottom}`, shadowed, '-gravity', 'center', '-geometry', '+0-6', '-composite', '-resize', '2000x', PNG_OUT, out)
  console.log(`  ${out} (${kb(out)})`)
}

/** A rounded crop with a hairline border. */
export function tile({ input, out, crop, tmp }) {
  const cut = join(tmp, 'tile-cut.png')
  const rounded = join(tmp, 'tile-rounded.png')
  magick(input, '-crop', cropArg(crop), '+repage', cut)
  roundCorners(cut, rounded, 18)
  magick(rounded, '(', '+clone', '-alpha', 'extract', '-morphology', 'EdgeOut', 'Diamond:2', '-background', '#d9dcea', '-alpha', 'shape', ')',
    '-compose', 'DstOver', '-composite', '-resize', '1200x', PNG_OUT, out)
  console.log(`  ${out} (${kb(out)})`)
}

/** Right-sidebar panels side by side on the light brand gradient. */
export function panelStrip({ rawDir, lang, out, tmp }) {
  const parts = PANELS[lang].map((name, i) => {
    const cut = join(tmp, `panel-${i}.png`)
    const rounded = join(tmp, `panel-${i}-r.png`)
    const finished = join(tmp, `panel-${i}-f.png`)
    magick(join(rawDir, `${lang}-light-${name}.png`), '-crop', cropArg(CROPS.panel), '+repage', cut)
    roundCorners(cut, rounded, 20)
    magick(rounded, '(', '+clone', '-alpha', 'extract', '-morphology', 'EdgeOut', 'Diamond:2', '-background', '#d5d9e8', '-alpha', 'shape', ')',
      '-compose', 'DstOver', '-composite', '-compose', 'Over', '(', '+clone', '-background', '#3a4060', '-shadow', '18x16+0+10', ')', '+swap',
      '-background', 'none', '-layers', 'merge', '+repage', finished)
    return finished
  })
  const row = join(tmp, 'panels-row.png')
  magick(parts, '-background', 'none', '+smush', '28', row)
  const [w, h] = execFileSync('magick', ['identify', '-format', '%w %h', row]).toString().split(' ').map(Number)
  const [top, bottom] = BACKGROUND.light
  magick('-size', `${w + 120}x${h + 100}`, `gradient:${top}-${bottom}`, row, '-gravity', 'center', '-composite', '-resize', '1600x>', PNG_OUT, out)
  console.log(`  ${out} (${kb(out)})`)
}

/** 1280×640 GitHub social preview rendered from social-card.html in an offscreen window. */
export function socialCard({ heroPng, out, tmp }) {
  const dir = join(tmp, 'social')
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  copyFileSync(new URL('./social-card.html', import.meta.url), join(dir, 'card.html'))
  copyFileSync(heroPng, join(dir, 'hero.png'))
  copyFileSync(join(REPO, 'src/renderer/public/fonts/geist-mono/GeistMono-Regular.woff2'), join(dir, 'GeistMono-Regular.woff2'))
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'readme-social-card', main: 'main.mjs', type: 'module' }))
  writeFileSync(join(dir, 'main.mjs'), `import { app, BrowserWindow } from 'electron'
import { writeFileSync } from 'node:fs'
app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1280, height: 640, show: false, webPreferences: { offscreen: { deviceScaleFactor: 2 } } })
  win.setBounds({ x: 0, y: 0, width: 1280, height: 640 })
  await win.loadFile('card.html')
  await new Promise((r) => setTimeout(r, 1200))
  // capturePage() is empty without a display; CDP screenshots work everywhere.
  win.webContents.debugger.attach('1.3')
  const { data } = await win.webContents.debugger.sendCommand('Page.captureScreenshot', {
    format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width: 1280, height: 640, scale: 2 },
  })
  writeFileSync('card.png', Buffer.from(data, 'base64'))
  app.quit()
})
`)
  execFileSync(electronBinary(), [...electronFlags(), '.'], { cwd: dir, stdio: 'ignore', timeout: 90_000 })
  magick(join(dir, 'card.png'), '-resize', '1280x640', PNG_OUT, out)
  console.log(`  ${out} (${kb(out)})`)
}
