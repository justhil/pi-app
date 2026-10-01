#!/usr/bin/env node
// Re-shoot every README visual from the real app:  npm run readme:capture [-- options]
//
//   --lang zh,en      languages to capture (default: zh,en)
//   --only a,b        subset of: screens, agent, composer, social
//   --work <dir>      scratch directory (default: <os tmp>/pi-readme-capture)
//   --skip-build      reuse <work>/app/out from a previous run
//   --keep-work       keep the scratch directory afterwards
//
// Output: doc/assets/readme/<lang>/{hero-light,hero-dark,timeline,panels}.png,
//         agent-turn.gif, composer-mention.gif and doc/assets/readme/social-preview.png
import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { prepareApp } from './app.mjs'
import { captureScreens } from './capture.mjs'
import { ASSET_DIR, CROPS, LANGS, MOCK_PORT, VIEWPORT } from './config.mjs'
import { checkTools, framedHero, framesToGif, panelStrip, socialCard, tile } from './media.mjs'
import { recordAgentTurn, recordComposer } from './record.mjs'
import { seedDemo } from './seed.mjs'

const { values } = parseArgs({
  options: {
    lang: { type: 'string', default: LANGS.join(',') },
    only: { type: 'string', default: 'screens,agent,composer,social' },
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

checkTools()
mkdirSync(rawDir, { recursive: true })
mkdirSync(tmp, { recursive: true })

console.log('• building capture app')
const appDir = prepareApp(work, { skipBuild: values['skip-build'] })

for (const lang of langs) {
  const out = join(ASSET_DIR, lang)
  mkdirSync(out, { recursive: true })

  if (only.has('screens')) {
    console.log(`• ${lang}: screenshots`)
    const demo = await seedDemo({ root: join(work, `demo-${lang}`), lang, mockPort: MOCK_PORT })
    for (const theme of ['light', 'dark']) await captureScreens({ appDir, demo, lang, theme, rawDir })
    framedHero({ input: join(rawDir, `${lang}-light-hero.png`), out: join(out, 'hero-light.png'), theme: 'light', tmp })
    framedHero({ input: join(rawDir, `${lang}-dark-hero.png`), out: join(out, 'hero-dark.png'), theme: 'dark', tmp })
    tile({ input: join(rawDir, `${lang}-light-tools.png`), out: join(out, 'timeline.png'), crop: CROPS.timeline, tmp })
    panelStrip({ rawDir, lang, out: join(out, 'panels.png'), tmp })
  }

  if (only.has('agent')) {
    console.log(`• ${lang}: live agent turn`)
    const demo = await seedDemo({ root: join(work, `live-${lang}`), lang, live: true, mockPort: MOCK_PORT })
    const framesDir = join(work, `frames-agent-${lang}`)
    await recordAgentTurn({ appDir, demo, lang, outDir: framesDir })
    framesToGif({ framesDir, out: join(out, 'agent-turn.gif'), width: VIEWPORT.width })
  }

  if (only.has('composer')) {
    console.log(`• ${lang}: composer`)
    const demo = await seedDemo({ root: join(work, `demo-${lang}`), lang, mockPort: MOCK_PORT })
    const framesDir = join(work, `frames-composer-${lang}`)
    await recordComposer({ appDir, demo, lang, outDir: framesDir })
    framesToGif({ framesDir, out: join(out, 'composer-mention.gif'), width: CROPS.composer.width, crop: CROPS.composer })
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
