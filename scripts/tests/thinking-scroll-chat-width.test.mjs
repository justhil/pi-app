import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'

const root = process.cwd()
const read = (path) => readFileSync(join(root, path), 'utf8').replace(/\r\n/g, '\n')

test('expanded thinking body owns scroll and uses readable typography', () => {
  const source = read('src/renderer/src/features/timeline/thinking-chain-block.tsx')
  const css = read('src/renderer/src/styles/globals.css')
  const labelRule = css.match(/\.thinking-chain-label\s*\{([^}]*)\}/)?.[1] ?? ''
  const bodyRule = css.match(/\.thinking-chain-body\s*\{([^}]*)\}/)?.[1] ?? ''

  assert.match(source, /data-independent-scroll/)
  assert.match(source, /max-h-(?:40|96|\[[^\]]+\])/)
  assert.match(source, /overflow-y-auto/)
  assert.match(source, /overscroll-contain/)
  assert.match(source, /text-\[13px\]/)
  assert.match(source, /leading-\[1\.(?:[6-9]|[6-9]\d+)\]/)
  assert.match(source, /thinking-chain-body/)
  assert.match(source, /border-border\/35/)
  assert.doesNotMatch(source, /font-mono[^'\n]*timeline-text-placeholder|timeline-text-placeholder[^'\n]*font-mono/)
  assert.match(labelRule, /color:\s*var\(--text-secondary\)/)
  assert.doesNotMatch(labelRule, /opacity:/)
  assert.match(bodyRule, /color:\s*var\(--text-secondary\)/)
  assert.doesNotMatch(bodyRule, /opacity:/)
})

function responsiveWidth(centerWidth, ratio, cap) {
  return Math.min(Math.max(Math.min(centerWidth, 560), centerWidth * ratio), Math.min(centerWidth, cap))
}

test('chat width formula is monotonic across target center widths', () => {
  const centerWidths = [375, 500, 560, 767, 768, 1024, 1440, 1920]
  const expectedTimeline = [375, 500, 560, 598.26, 599.04, 798.72, 800, 800]
  const expectedComposer = [375, 500, 560, 598.26, 599.04, 798.72, 800, 800]
  const timelineWidths = centerWidths.map((width) => Number(responsiveWidth(width, 0.78, 800).toFixed(2)))
  const composerWidths = centerWidths.map((width) => Number(responsiveWidth(width, 0.78, 800).toFixed(2)))

  assert.deepEqual(timelineWidths, expectedTimeline)
  assert.deepEqual(composerWidths, expectedComposer)
  for (const widths of [timelineWidths, composerWidths]) {
    for (let index = 1; index < widths.length; index += 1) {
      assert.ok(widths[index] >= widths[index - 1], `${widths[index]} decreased from ${widths[index - 1]}`)
    }
  }
})

test('chat widths are driven by center-column responsive CSS', () => {
  const css = read('src/renderer/src/styles/globals.css')
  const main = read('src/renderer/src/main.tsx')
  const legacyPath = join(root, 'src/renderer/src/lib/chat-content-width.ts')

  assert.match(css, /--chat-content-min:\s*560px/)
  assert.match(css, /--chat-content-ratio:\s*78%/)
  assert.match(css, /--chat-content-cap:\s*800px/)
  assert.match(css, /--timeline-content-max:\s*clamp\(/)
  assert.match(css, /--composer-content-ratio:\s*78%/)
  assert.match(css, /--composer-content-cap:\s*800px/)
  assert.match(css, /\.chat-content-column\s*\{[^}]*max-width:\s*var\(--timeline-content-max\)/s)
  assert.match(css, /\.composer-dock-inner\s*\{[^}]*max-width:\s*var\(--composer-content-max\)/s)
  assert.doesNotMatch(css, /@media \(max-width: 767px\)[\s\S]*?--(?:timeline|composer)-content-max:\s*100%/)
  assert.doesNotMatch(css, /--(?:composer|timeline)-content-max-px/)
  assert.doesNotMatch(main, /syncChatContentMaxWidths|chat-content-width/)
  assert.equal(existsSync(legacyPath), false)
})
