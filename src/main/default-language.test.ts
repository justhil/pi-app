import { describe, expect, it } from 'vitest'
import { defaultAppLanguage } from './default-language'

describe('defaultAppLanguage', () => {
  it('follows POSIX locale variables in precedence order', () => {
    expect(defaultAppLanguage({ LANG: 'zh_CN.UTF-8' }, 'en-US')).toBe('zh')
    expect(defaultAppLanguage({ LC_ALL: 'en_US.UTF-8', LANG: 'zh_CN.UTF-8' }, 'zh-CN')).toBe('en')
    expect(defaultAppLanguage({ LC_MESSAGES: 'zh_TW.UTF-8', LANG: 'en_US.UTF-8' }, 'en-US')).toBe('zh')
  })

  it('falls back to English outside a Chinese locale', () => {
    expect(defaultAppLanguage({ LANG: 'de_DE.UTF-8' }, 'zh-CN')).toBe('en')
    expect(defaultAppLanguage({ LANG: 'C.UTF-8' }, 'en-US')).toBe('en')
    expect(defaultAppLanguage({}, 'fr-FR')).toBe('en')
  })

  it('uses the system locale when no locale variable is set (Windows, macOS)', () => {
    expect(defaultAppLanguage({}, 'zh-Hans-CN')).toBe('zh')
    expect(defaultAppLanguage({ LANG: '' }, 'zh-CN')).toBe('zh')
  })
})
