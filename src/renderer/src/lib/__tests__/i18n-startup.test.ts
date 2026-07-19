import { afterEach, describe, expect, it, vi } from 'vitest'
import i18n, { hydrateLanguageFromSettings } from '../i18n'
import { ipcClient } from '../ipc-client'

describe('startup language hydration', () => {
  const initialLanguage = i18n.resolvedLanguage || i18n.language

  afterEach(async () => {
    vi.restoreAllMocks()
    await i18n.changeLanguage(initialLanguage)
  })

  it('should_use_saved_chinese_when_current_language_is_english', async () => {
    await i18n.changeLanguage('en')
    const invokeMock = vi.spyOn(ipcClient, 'invoke').mockResolvedValue({
      settings: { language: 'zh' },
    })

    const resolvedLanguage = await hydrateLanguageFromSettings()

    expect(invokeMock).toHaveBeenCalledWith('settings.get', { key: 'language' })
    expect(resolvedLanguage).toBe('zh')
    expect(i18n.resolvedLanguage).toBe('zh')
    expect(document.documentElement.lang).toBe('zh-CN')
  })

  it('should_fall_back_without_blocking_when_settings_read_fails', async () => {
    const originalLanguage = i18n.resolvedLanguage
    vi.spyOn(ipcClient, 'invoke').mockRejectedValue(new Error('settings unavailable'))

    await expect(hydrateLanguageFromSettings()).resolves.toMatch(/^(zh|en)$/)
    expect(i18n.resolvedLanguage).toBe(originalLanguage)
  })
})
