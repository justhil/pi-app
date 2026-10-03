import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'

const root = process.cwd()
const read = (path) => readFileSync(join(root, path), 'utf8').replace(/\r\n/g, '\n')
const source = read('src/renderer/src/features/composer/composer.tsx')
const css = read('src/renderer/src/styles/globals.css')

function cssRule(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`))?.[1] ?? ''
}

function classLiteralContaining(token) {
  return [...source.matchAll(/'([^'\n]*)'/g)]
    .map((match) => match[1])
    .find((classes) => classes.split(/\s+/).includes(token)) ?? ''
}

test('composer shell and drag overlay share the embedded 14px radius', () => {
  const dropOverlayClasses = classLiteralContaining('composer-drop-overlay')
  const shellClasses = classLiteralContaining('composer-shell')
  const shellRule = cssRule('.composer-shell')
  const overlayRule = cssRule('.composer-drop-overlay')

  assert.notEqual(dropOverlayClasses, '')
  assert.notEqual(shellClasses, '')
  assert.match(css, /--composer-shell-radius:\s*14px/)
  assert.match(shellRule, /border-radius:\s*var\(--composer-shell-radius\)/)
  assert.match(overlayRule, /border-radius:\s*var\(--composer-shell-radius\)/)
  assert.doesNotMatch(dropOverlayClasses, /(?:^|\s)rounded-(?:xl|2xl)(?:\s|$)/)
  assert.doesNotMatch(shellClasses, /(?:^|\s)rounded-(?:xl|2xl)(?:\s|$)/)
})

test('composer overlay is the first child of the relative shell after queue and preview chrome', () => {
  const queueIndex = source.indexOf('<ComposerPendingQueue />')
  const previewIndex = source.indexOf('{sessionPreview && (')
  const shellClasses = classLiteralContaining('composer-shell')
  const shellClassIndex = source.indexOf(`'${shellClasses}'`)
  const shellTagStart = source.lastIndexOf('<div', shellClassIndex)
  const shellWindow = source.slice(shellTagStart, shellTagStart + 1400)
  const firstChildMatch = shellWindow.match(
    /^<div[\s\S]{0,900}?className=\{cn\([\s\S]{0,700}?\)\}\s*>\s*<div\s+className=\{cn\(\s*'([^']*)'/,
  )

  assert.notEqual(shellClasses, '')
  assert.ok(shellTagStart >= 0)
  assert.ok(queueIndex >= 0 && queueIndex < shellTagStart)
  assert.ok(previewIndex >= 0 && previewIndex < shellTagStart)
  assert.ok(firstChildMatch, 'composer overlay must be the shell first JSX element child')
  assert.ok(firstChildMatch[1].split(/\s+/).includes('composer-drop-overlay'))
  assert.doesNotMatch(source, /composer-shell-wrap/)
})

test('composer states use a hairline lift, not a wide floating shadow', () => {
  const rootRule = cssRule(':root')
  const darkRule = cssRule('.dark')
  const shellRule = cssRule('.composer-shell')
  const hoverRule = cssRule('.composer-shell:hover:not(.composer-shell-focused)')
  const focusRule = cssRule('.composer-shell-focused')

  for (const rule of [rootRule, darkRule]) {
    assert.match(rule, /--composer-shell-border:/)
    assert.match(rule, /--composer-shell-shadow:/)
    assert.match(rule, /--composer-shell-shadow-hover:/)
    assert.match(rule, /--composer-shell-shadow-focus:/)
    assert.match(rule, /--composer-shell-shadow-recording:/)
    assert.match(rule, /--composer-shell-shadow-hero:/)
    assert.match(rule, /--composer-shell-shadow-hero-focus:/)
    assert.match(rule, /0\s+1px\s+2px/)
    // Soft lift with a negative spread keeps the shadow tucked under the shell.
    assert.match(rule, /0\s+(?:6|8|10|12)px\s+(?:16|18|20|24|26)px\s+-\d+px/)
    // The old floating look: wide blur without negative spread.
    assert.doesNotMatch(rule, /0\s+(?:10|12|14|18|20)px\s+(?:28|30|34|44|48)px\s+rgba/)
  }

  assert.match(shellRule, /border-color:\s*var\(--composer-shell-border\)/)
  assert.match(shellRule, /box-shadow:\s*var\(--composer-shell-shadow\)/)
  assert.match(hoverRule, /box-shadow:\s*var\(--composer-shell-shadow-hover\)/)
  assert.match(focusRule, /border-color:\s*var\(--composer-shell-border-focus\)/)
  assert.match(focusRule, /box-shadow:\s*var\(--composer-shell-shadow-focus\)/)
  assert.doesNotMatch(focusRule, /var\(--focus-shadow\)/)
  for (const rule of [rootRule, darkRule]) {
    assert.match(rule, /--composer-shell-shadow-focus:[^;]*0\s+0\s+0\s+1px/s)
    assert.doesNotMatch(rule, /--composer-shell-shadow-focus:[^;]*0\s+0\s+0\s+3px/s)
  }
})

test('voice and hero variants preserve composer elevation without a wide halo', () => {
  const recordingRule = cssRule('.composer-shell--voice-recording')
  const transcribingRule = cssRule('.composer-shell--voice-transcribing')
  const heroRule = cssRule('.composer-dock-hero .composer-shell')
  const heroFocusRule = cssRule('.composer-dock-hero .composer-shell-focused')

  assert.match(recordingRule, /box-shadow:\s*var\(--composer-shell-shadow-recording\)/)
  assert.match(transcribingRule, /box-shadow:\s*var\(--composer-shell-shadow\)/)
  assert.match(heroRule, /box-shadow:\s*var\(--composer-shell-shadow-hero\)/)
  assert.match(heroFocusRule, /box-shadow:\s*var\(--composer-shell-shadow-hero-focus\)/)
  assert.doesNotMatch(heroFocusRule, /0\s+0\s+0\s+3px|halo/)
})
