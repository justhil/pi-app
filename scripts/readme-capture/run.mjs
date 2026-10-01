#!/usr/bin/env node
// Re-shoot every README visual from the real app:  npm run readme:capture [-- options]
//
//   --lang zh,en      languages to capture (default: zh,en)
//   --only a,b        subset of the steps below (default: all)
//   --work <dir>      scratch directory (default: <os tmp>/pi-readme-capture)
//   --skip-build      reuse <work>/app/out from a previous run
//   --keep-work       keep the scratch directory afterwards
//
// Steps and outputs (doc/assets/readme/<lang>/ unless noted):
//   screens   hero-light.png, hero-dark.png, timeline.png, panels.png
//   agent     agent-turn.gif           real worker turn against the scripted endpoint
//   composer  composer-mention.gif
//   review    review-stage.gif         widen panel, side-by-side diff, stage a hunk
//   files     files-preview.gif        tabs, line reference, expanded preview
//   parallel  parallel-sessions.gif    two sessions running at once
//   visuals   overview.png, architecture-{light,dark}.png, theme-switch.gif (frontend-rendered;
//             needs the screens and parallel steps of the same run)
//   social    doc/assets/readme/social-preview.png
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { prepareApp } from './app.mjs'
import { captureScreens } from './capture.mjs'
import { ASSET_DIR, CROPS, LANGS, MOCK_PORT, VIEWPORT } from './config.mjs'
import { checkTools, framedHero, framesToGif, panelStrip, socialCard, tile } from './media.mjs'
import { recordAgentTurn, recordComposer, recordFiles, recordParallel, recordReviewStage } from './record.mjs'
import { renderPages } from './render.mjs'
import { seedDemo } from './seed.mjs'
import { visualJobs } from './visuals.mjs'

const STEPS = ['screens', 'agent', 'composer', 'review', 'files', 'parallel', 'visuals', 'social']
const { values } = parseArgs({
  options: {
    lang: { type: 'string', default: LANGS.join(',') },
    only: { type: 'string', default: STEPS.join(',') },
    work: { type: 'string', default: join(tmpdir(), 'pi-readme-capture') },
    'skip-build': { type: 'boolean', default: false },
    'keep-work': { type: 'boolean', default: false },
  },
})
const langs = values.lang.split(',').filter((lang) => LANGS.includes(lang))
const only = new Set(values.only.split(','))
const work = resolve(values.work)
const rawDir = join(work, 'raw')
const tmp = join(work, 'tmp')

/** Downscale a rendered/captured PNG for the README and store it as 8-bit. */
const optimize = (file, width) => execFileSync('magick', [file, '-resize', `${width}x>`, '-strip', '-depth', '8', '-define', 'png:compression-level=9', file])

checkTools()
mkdirSync(rawDir, { recursive: true })
mkdirSync(tmp, { recursive: true })

console.log('• building capture app')
const appDir = prepareApp(work, { skipBuild: values['skip-build'] })

for (const lang of langs) {
  const out = join(ASSET_DIR, lang)
  mkdirSync(out, { recursive: true })
  const staticDemo = () => seedDemo({ root: join(work, `demo-${lang}`), lang, mockPort: MOCK_PORT })
  const liveDemo = (name) => seedDemo({ root: join(work, `${name}-${lang}`), lang, live: true, mockPort: MOCK_PORT })
  const frames = (name) => join(work, `frames-${name}-${lang}`)
  const parallelStill = join(rawDir, `${lang}-parallel-still.png`)

  if (only.has('screens')) {
    console.log(`• ${lang}: screenshots`)
    const demo = await staticDemo()
    for (const theme of ['light', 'dark']) await captureScreens({ appDir, demo, lang, theme, rawDir })
    framedHero({ input: join(rawDir, `${lang}-light-hero.png`), out: join(out, 'hero-light.png'), theme: 'light', tmp })
    framedHero({ input: join(rawDir, `${lang}-dark-hero.png`), out: join(out, 'hero-dark.png'), theme: 'dark', tmp })
    tile({ input: join(rawDir, `${lang}-light-tools.png`), out: join(out, 'timeline.png'), crop: CROPS.timeline, tmp })
    panelStrip({ rawDir, lang, out: join(out, 'panels.png'), tmp })
  }

  if (only.has('agent')) {
    console.log(`• ${lang}: live agent turn`)
    await recordAgentTurn({ appDir, demo: await liveDemo('live'), lang, outDir: frames('agent') })
    framesToGif({ framesDir: frames('agent'), out: join(out, 'agent-turn.gif'), width: VIEWPORT.width })
  }

  if (only.has('composer')) {
    console.log(`• ${lang}: composer`)
    await recordComposer({ appDir, demo: await staticDemo(), lang, outDir: frames('composer') })
    framesToGif({ framesDir: frames('composer'), out: join(out, 'composer-mention.gif'), width: CROPS.composer.width, crop: CROPS.composer })
  }

  if (only.has('review')) {
    console.log(`• ${lang}: review staging`)
    await recordReviewStage({ appDir, demo: await staticDemo(), lang, outDir: frames('review') })
    framesToGif({ framesDir: frames('review'), out: join(out, 'review-stage.gif'), width: 1280 })
  }

  if (only.has('files')) {
    console.log(`• ${lang}: files panel`)
    await recordFiles({ appDir, demo: await staticDemo(), lang, outDir: frames('files') })
    framesToGif({ framesDir: frames('files'), out: join(out, 'files-preview.gif'), width: 1280 })
  }

  if (only.has('parallel')) {
    console.log(`• ${lang}: parallel sessions`)
    await recordParallel({ appDir, demo: await liveDemo('parallel'), lang, outDir: frames('parallel'), stillPath: parallelStill })
    framesToGif({ framesDir: frames('parallel'), out: join(out, 'parallel-sessions.gif'), width: 1280 })
  }

  if (only.has('visuals')) {
    console.log(`• ${lang}: rendered visuals`)
    for (const need of [`${lang}-light-review-wide.png`, `${lang}-light-mention-chip.png`, `${lang}-parallel-still.png`]) {
      if (!existsSync(join(rawDir, need))) throw new Error(`readme-capture: visuals need ${need}; run the screens and parallel steps too`)
    }
    renderPages(visualJobs({ lang, rawDir, parallelStill, tmp, outDir: out }), tmp)
    for (const name of ['overview.png', 'architecture-light.png', 'architecture-dark.png']) optimize(join(out, name), 1800)
    framesToGif({ framesDir: join(tmp, `frames-theme-${lang}`), out: join(out, 'theme-switch.gif'), width: 960 })
  }
}

if (only.has('social')) {
  console.log('• social preview')
  const hero = join(rawDir, 'en-light-hero.png')
  if (!existsSync(hero)) {
    const demo = await seedDemo({ root: join(work, 'demo-en'), lang: 'en', mockPort: MOCK_PORT })
    await captureScreens({ appDir, demo, lang: 'en', theme: 'light', rawDir })
  }
  socialCard({ heroPng: hero, out: join(ASSET_DIR, 'social-preview.png'), tmp })
}

if (!values['keep-work']) rmSync(work, { recursive: true, force: true })
console.log('done')
