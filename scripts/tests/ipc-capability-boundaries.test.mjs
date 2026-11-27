import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()

describe('IPC capability boundaries', () => {
  it('readImagePreview requires workspace containment', () => {
    const ws = readFileSync(join(root, 'src/main/ipc/handlers/workspace-fs.ts'), 'utf8')
    assert.match(ws, /shellReadImagePreviewSchema/)
    assert.match(ws, /resolvePathUnderWorkspace/)
    assert.doesNotMatch(ws, /return pathInput/)
  })

  it('review mutations gate cwd against trusted workspace', () => {
    const review = readFileSync(join(root, 'src/main/ipc/handlers/review.ts'), 'utf8')
    assert.match(review, /reviewMutationSchema/)
    assert.match(review, /authorize(?:Trusted|Project)Cwd/)
    const tw = readFileSync(join(root, 'src/main/trusted-workspace.ts'), 'utf8')
    assert.match(tw, /cwd_not_trusted/)
  })

  it('sdk.install validates registry membership', () => {
    const sdk = readFileSync(join(root, 'src/main/ipc/handlers/pi-sdk.ts'), 'utf8')
    const mgr = readFileSync(join(root, 'src/main/sdk-manager.ts'), 'utf8')
    assert.match(sdk, /if \(!isAllowedSdkVersion\(version, registry\)\)/)
    assert.ok(sdk.indexOf('if (!isAllowedSdkVersion') < sdk.indexOf('await installVersion'))
    assert.match(mgr, /process\.platform === 'win32' \? 'npm\.cmd' : 'npm'/)
    assert.match(mgr, /shell: process\.platform === 'win32'/)
    assert.match(mgr, /AbortSignal\.timeout/)
  })

  it('clipboard temp image uses schema and byte cap', () => {
    const prompt = readFileSync(join(root, 'src/main/ipc/handlers/prompt.ts'), 'utf8')
    const schemas = readFileSync(join(root, 'src/main/ipc/schemas.ts'), 'utf8')
    assert.match(prompt, /clipboardWriteTempImageSchema/)
    assert.match(schemas, /CLIPBOARD_IMAGE_MAX_BYTES/)
  })
})