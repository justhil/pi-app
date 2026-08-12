import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { applyPiSettingsPatch } from './pi-settings-patch'

function manager(errors: Array<{ scope: 'global' | 'project'; error: Error }>) {
  return {
    setDefaultModelAndProvider: vi.fn(),
    setDefaultProvider: vi.fn(),
    setDefaultModel: vi.fn(),
    setDefaultThinkingLevel: vi.fn(),
    setSteeringMode: vi.fn(),
    setFollowUpMode: vi.fn(),
    setTransport: vi.fn(),
    setCompactionEnabled: vi.fn(),
    setShellPath: vi.fn(),
    setImageAutoResize: vi.fn(),
    setEnabledModels: vi.fn(),
    setRetryEnabled: vi.fn(),
    setHideThinkingBlock: vi.fn(),
    setShowImages: vi.fn(),
    setBlockImages: vi.fn(),
    setEnableSkillCommands: vi.fn(),
    setQuietStartup: vi.fn(),
    setDefaultProjectTrust: vi.fn(),
    setShellCommandPrefix: vi.fn(),
    setNpmCommand: vi.fn(),
    setTreeFilterMode: vi.fn(),
    setDoubleEscapeAction: vi.fn(),
    setHttpIdleTimeoutMs: vi.fn(),
    setProjectTrusted: vi.fn(),
    flush: vi.fn(async () => {}),
    drainErrors: vi.fn(() => errors),
    globalSettings: {},
    markModified: vi.fn(),
    save: vi.fn(),
  }
}

describe('applyPiSettingsPatch', () => {
  it('should_convert_windows_sdk_paths_to_file_urls', () => {
    const source = readFileSync('src/preview/index.ts', 'utf8')
    expect(source).toContain("pathToFileURL(message.activeSdkPath).href")
    expect(source).toContain('{ projectTrusted: false }')
  })

  it('should_ignore_project_parse_errors_when_global_settings_were_saved', async () => {
    await expect(applyPiSettingsPatch(
      manager([{ scope: 'project', error: new Error('broken project settings') }]) as never,
      { defaultProvider: 'openai', defaultModel: 'gpt-5' },
    )).resolves.toBeUndefined()
  })

  it('should_report_global_settings_write_errors', async () => {
    await expect(applyPiSettingsPatch(
      manager([{ scope: 'global', error: new Error('global write failed') }]) as never,
      { defaultProvider: 'openai', defaultModel: 'gpt-5' },
    )).rejects.toThrow('global write failed')
  })
})
