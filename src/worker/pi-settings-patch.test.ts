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

describe('applyPiSettingsPatch newer pi keys', () => {
  it('writes per-model thinking levels and nested retry fields through the merge-only save path', async () => {
    const sm = manager([])
    await applyPiSettingsPatch(sm as never, {
      modelThinkingLevels: { 'openai/gpt-6': 'MAX', 'bad-key': 'high', 'anthropic/x': 'nope' },
      retryMaxAgentDelayMs: 30000,
      retryMaxRetries: 5,
      cacheWarming: 'idle',
      websocketConnectTimeoutMs: 8000,
    })
    expect(sm.globalSettings).toMatchObject({
      modelThinkingLevels: { 'openai/gpt-6': 'max' },
      retry: { maxAgentDelayMs: 30000, maxRetries: 5 },
      cacheWarming: 'idle',
      websocketConnectTimeoutMs: 8000,
    })
    expect(sm.markModified).toHaveBeenCalledWith('modelThinkingLevels')
    expect(sm.markModified).toHaveBeenCalledWith('retry', 'maxAgentDelayMs')
    expect(sm.markModified).toHaveBeenCalledWith('cacheWarming')
  })

  it('removes the binding map when it becomes empty and rejects unknown cache modes', async () => {
    const sm = manager([])
    sm.globalSettings = { modelThinkingLevels: { 'openai/gpt-6': 'high' } }
    await applyPiSettingsPatch(sm as never, { modelThinkingLevels: {} })
    expect(sm.globalSettings).not.toHaveProperty('modelThinkingLevels')
    await expect(applyPiSettingsPatch(sm as never, { cacheWarming: 'always' })).rejects.toThrow('Invalid cacheWarming')
  })

  it('writes defaultTools and codemode settings, clearing defaultTools with null', async () => {
    const sm = manager([])
    await applyPiSettingsPatch(sm as never, { defaultTools: ['-bash', '+codemode'], codemodeMode: 'only', codemodeInlineBudget: 1500 })
    expect(sm.globalSettings).toMatchObject({ defaultTools: ['-bash', '+codemode'], codemode: { mode: 'only', inlineBudget: 1500 } })
    expect(sm.markModified).toHaveBeenCalledWith('codemode', 'mode')
    await applyPiSettingsPatch(sm as never, { defaultTools: null })
    expect(sm.globalSettings).not.toHaveProperty('defaultTools')
    await expect(applyPiSettingsPatch(sm as never, { defaultTools: ['rm -rf'] })).rejects.toThrow('Invalid defaultTools')
    await expect(applyPiSettingsPatch(sm as never, { codemodeMode: 'off' })).rejects.toThrow('Invalid codemode.mode')
  })

  it('writes thinking budgets and per-model compaction overrides, dropping invalid values', async () => {
    const sm = manager([])
    sm.globalSettings = { compaction: { reserveTokens: 16384 } }
    await applyPiSettingsPatch(sm as never, {
      thinkingBudgets: { low: 2048, high: 32768, max: 1, medium: -1 },
      compactionModelOverrides: { 'p/big': { reserveTokens: 400000, keepRecentTokens: 'x' }, nope: { reserveTokens: 1 }, 'p/empty': {} },
    })
    expect(sm.globalSettings).toEqual({
      thinkingBudgets: { low: 2048, high: 32768 },
      compaction: { reserveTokens: 16384, modelOverrides: { 'p/big': { reserveTokens: 400000 } } },
    })
    await applyPiSettingsPatch(sm as never, { thinkingBudgets: null, compactionModelOverrides: {} })
    expect(sm.globalSettings).toEqual({ compaction: { reserveTokens: 16384 } })
  })
})
