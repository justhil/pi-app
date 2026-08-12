import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

const previewEntry = readFileSync('out/main/preview.mjs', 'utf8')
const importedChunks = [...previewEntry.matchAll(/from "(\.\/chunks\/[^"]+)"/g)].map((match) => match[1])
const previewBundle = [previewEntry]
  .concat(importedChunks.map((path) => readFileSync(`out/main/${path.slice(2)}`, 'utf8')))
  .join('\n')

const wslPreviewEntry = readFileSync('out/main/preview-wsl.mjs', 'utf8')
const wslImportedChunks = [...wslPreviewEntry.matchAll(/from "(\.\/chunks\/[^"]+)"/g)].map((match) => match[1])
const wslPreviewBundle = [wslPreviewEntry]
  .concat(wslImportedChunks.map((path) => readFileSync(`out/main/${path.slice(2)}`, 'utf8')))
  .join('\n')

describe('preview utility bundle', () => {
  it('should_not_import_electron_main_apis_when_started_as_a_utility_process', () => {
    expect(previewBundle).not.toMatch(/import\s*\{[^}]*\bapp\b[^}]*\}\s*from\s*["']electron["']/)
    expect(previewBundle).not.toContain('electronAPI')
    expect(previewBundle).not.toContain("from 'electron'")
    expect(previewBundle).not.toContain('worker-manager')
  })

  it('keeps the WSL preview bundle read-only and independent from worker runtime', () => {
    for (const forbidden of [
      'worker-manager',
      'WorkerManager',
      'forkWorker',
      'initSession',
      'SessionManager.create',
    ]) {
      expect(wslPreviewBundle).not.toContain(forbidden)
    }
    expect(wslPreviewBundle).toContain('SettingsManager.fromStorage')
    expect(wslPreviewBundle).toContain('createSettingsStorage')
    expect(wslPreviewBundle).toContain('projectTrusted: true')
    expect(wslPreviewBundle).toContain('ModelRuntime.create')
    expect(wslPreviewBundle).toContain('modelsPath: null')
    expect(wslPreviewBundle).toContain('packages: []')
    expect(wslPreviewBundle).toContain('extensions: []')
    expect(wslPreviewBundle).toContain('SessionManager.inMemory')
    expect(wslPreviewBundle).toContain('createAgentSession')
    expect(wslPreviewBundle).toContain('SessionManager.list')
    expect(wslPreviewEntry.length).toBeGreaterThan(0)
  })
})
