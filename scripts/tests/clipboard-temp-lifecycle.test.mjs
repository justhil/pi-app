import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()

describe('clipboard temp image lifecycle', () => {
  it('should_retain_clipboard_images_after_prompt_send_for_agent_read', () => {
    const prompt = readFileSync(join(root, 'src/main/ipc/handlers/prompt.ts'), 'utf8')
    const store = readFileSync(join(root, 'src/main/clipboard-temp-images.ts'), 'utf8')

    // Files must survive send: agent tools (read) resolve the path after the prompt is accepted.
    const sendHandler = prompt.slice(
      prompt.indexOf("registerHandlerWithSchema('ipc:prompt.send'"),
      prompt.indexOf("registerHandlerWithSchema('ipc:clipboard.writeTempImage'"),
    )
    assert.doesNotMatch(
      sendHandler,
      /releaseAllClipboardTempImages\s*\(/,
      'prompt.send must not delete clipboard images before/while the agent turn runs',
    )

    // Writes go through durable helper that tracks for optional prune/quit cleanup.
    assert.match(prompt, /writeClipboardTempImage/)
    assert.match(store, /trackClipboardTempImage/)
    assert.match(store, /resolveClipboardImageDir|clipboard-images/)
    assert.match(store, /pruneStaleClipboardImages/)
  })

  it('should_store_clipboard_images_under_app_userData_not_only_os_tmpdir', () => {
    const prompt = readFileSync(join(root, 'src/main/ipc/handlers/prompt.ts'), 'utf8')
    const store = readFileSync(join(root, 'src/main/clipboard-temp-images.ts'), 'utf8')
    assert.match(store, /getPath\(['"]userData['"]\)|userData/)
    assert.match(prompt, /writeClipboardTempImage/)
    assert.doesNotMatch(
      prompt,
      /join\(tmpdir\(\),\s*`pi-clipboard/,
      'OS tmpdir is cleaned by the system; use durable app storage',
    )
  })
})
