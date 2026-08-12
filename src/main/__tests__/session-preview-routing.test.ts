import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const read = (file: string) => readFileSync(join(root, file), 'utf8')

describe('session preview process routing', () => {
  it('routes list, messages and tree through a non-binding utility process', () => {
    const sessionHandler = read('src/main/ipc/handlers/session.ts')
    const workspaceHandler = read('src/main/ipc/handlers/workspace.ts')
    const previewManager = read('src/main/session-preview-process.ts')
    const wslPreviewRunner = read('src/main/wsl/session-preview-runner.ts')
    const previewEntry = read('src/preview/index.ts')
    const sdkSession = read('src/main/ipc/sdk-session.ts')
    const diskMessages = read('src/main/session-messages-from-disk.ts')

    expect(sessionHandler).toContain('sessionPreviewProcess.listSessions')
    expect(sessionHandler).toContain('sessionPreviewProcess.getMessages')
    expect(sessionHandler).toContain('sessionPreviewProcess.getTree')
    expect(workspaceHandler).toContain('sessionPreviewProcess.listSessions')
    expect(previewManager).toContain("utilityProcess.fork(resolveUtilityEntry('preview.mjs')")
    expect(previewManager).not.toContain("import('./worker-manager')")
    expect(wslPreviewRunner).toContain('spawnPreviewInWsl')
    expect(wslPreviewRunner).not.toContain('WorkerManager')
    expect(previewEntry).not.toContain('loadSession')
    expect(previewEntry).not.toContain('WorkerManager')
    expect(previewEntry).not.toContain('worker-manager')
    expect(previewEntry).toContain('system.prompt')
    expect(previewEntry).toContain('buildSystemPromptPreview')
    expect(sdkSession).not.toContain("from 'electron'")
    expect(diskMessages).not.toContain("from 'electron'")
    expect(previewEntry).toContain('message.userDataDir')
    expect(previewEntry).toContain('message.activeSdkPath')
    expect(read('src/main/__tests__/session-preview-runtime.test.ts')).toContain("not.toContain('worker-manager')")
    expect(read('src/main/wsl/session-preview-runner.test.ts')).toContain('pool = new Map')
    expect(read('src/main/wsl/session-preview-runner.test.ts')).toContain("wslCwd: '/mnt/c/Project'")
  })

  it('packages the preview entry beside the worker entry', () => {
    const config = read('electron.vite.config.ts')
    expect(config).toContain("preview: resolve(__dirname, 'src/preview/index.ts')")
    expect(config).toContain("'preview-wsl': resolve(__dirname, 'src/preview/wsl.ts')")
    expect(config).toContain("chunk.name === 'worker' || chunk.name === 'preview' || chunk.name === 'preview-wsl'")
    expect(read('src/main/worker-manager-pool.ts')).toContain("resolveUtilityEntry('worker.mjs')")
    expect(read('src/main/wsl/worker-host.ts')).toContain("resolveUtilityEntry('worker.mjs')")
  })
})
