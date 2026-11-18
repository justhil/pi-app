import { describe, expect, it } from 'vitest'
import {
  defaultAgentPurgeConfig,
  normalizeAgentPurgeConfig,
  parsePersonaMarkdown,
  personaCopy,
  personaLanguage,
  rewriteSystemPromptText,
  stripHostIdentity,
} from './agent-purge'

describe('agent-purge shared core', () => {
  it('ships all three built-in presets (konata, ctf, neutral) with clean bodies', () => {
    const cfg = defaultAgentPurgeConfig()
    expect(cfg.personas.map((p) => p.id)).toEqual(['konata', 'ctf', 'neutral'])
    expect(cfg.defaultPersonaId).toBe('konata')
    expect(cfg.defaultMode).toBe('replace')
    for (const p of cfg.personas) {
      expect(p.body.length).toBeGreaterThan(100)
      expect(p.body.startsWith('---')).toBe(false)
    }
  })

  it('drops retired built-in presets from persisted config and falls back defaultPersonaId while preserving custom personas', () => {
    const normalized = normalizeAgentPurgeConfig({
      defaultPersonaId: 'xiaomajiang',
      defaultMode: 'replace',
      personas: [
        {
          id: 'dafeiyu',
          name: '大肥鱼 · 岚的专属',
          description: '',
          body: 'retired builtin body',
          builtin: true,
          order: 1,
        },
        {
          id: 'xiaomajiang',
          name: '小码酱 · YG 专属',
          description: '',
          body: 'retired builtin body',
          builtin: true,
          order: 2,
        },
        {
          id: 'my-custom',
          name: 'My Custom',
          description: '',
          body: 'custom persona body',
        },
      ],
    })
    expect(normalized.personas.some((p) => p.id === 'dafeiyu')).toBe(false)
    expect(normalized.personas.some((p) => p.id === 'xiaomajiang')).toBe(false)
    expect(normalized.personas.some((p) => p.id === 'my-custom')).toBe(true)
    expect(normalized.defaultPersonaId).toBe('konata')
  })

  it('strips Pi default host identity sentence while keeping tool guidance intact', () => {
    const host =
      'You are a coding assistant running inside pi, a coding agent harness. Help users inspect files, run commands, and modify code.'
    expect(stripHostIdentity(host)).toBe('Help users inspect files, run commands, and modify code.')
  })

  it('supports replace, append, and strict prompt rewrite modes', () => {
    const host = 'You are Claude, an AI assistant.\nAlways show file paths.'
    expect(rewriteSystemPromptText(host, '# Custom Persona', 'replace')).toBe(
      '# Custom Persona\n\nAlways show file paths.',
    )
    expect(rewriteSystemPromptText(host, '# Custom Persona', 'append')).toBe(
      `${host}\n\n# Custom Persona`,
    )
    expect(rewriteSystemPromptText(host, '# Custom Persona', 'strict')).toBe('# Custom Persona')
  })

  it('parses markdown frontmatter and strips metadata from prompt body', () => {
    const doc = [
      '---',
      'id: concise-dev',
      'name: 简洁工程',
      'description: 中文先给结论',
      '---',
      '',
      '直接进入正题，先读代码再修改。',
    ].join('\n')
    const parsed = parsePersonaMarkdown(doc, 'fallback')
    expect(parsed).toEqual({
      id: 'concise-dev',
      name: '简洁工程',
      description: '中文先给结论',
      body: '直接进入正题，先读代码再修改。',
    })
  })

  it('localizes the persona name, description, and prompt body per UI language', () => {
    const cfg = defaultAgentPurgeConfig()
    const konata = cfg.personas.find((p) => p.id === 'konata')!
    expect(personaCopy(konata, 'ru').name).toBe('Коната Изуми · исполнение в песочнице')
    expect(personaCopy(konata, 'en').name).toBe('Konata Izumi · Sandbox execution')
    expect(personaCopy(konata, 'zh').name).toBe('泉此方 · 沙箱执行')
    expect(personaCopy(konata, 'ru').description).not.toBe(konata.description)

    expect(personaCopy(konata, 'zh').body).toContain('泉此方')
    expect(personaCopy(konata, 'en').body).toContain('Konata Izumi')
    expect(personaCopy(konata, 'en').body).not.toMatch(/[\u4e00-\u9fff]/)
    expect(personaCopy(konata, 'ru').body).toContain('Коната Изуми')
    expect(personaCopy(konata, 'ru').body).not.toMatch(/[\u4e00-\u9fff]/)

    expect(personaLanguage('zh-CN')).toBe('zh')
    expect(personaLanguage('ru-RU')).toBe('ru')
    expect(personaLanguage(undefined)).toBe('en')
  })

  it('backfills localized built-in bodies for uncustomized presets while preserving custom edits', () => {
    const cfg = normalizeAgentPurgeConfig({
      defaultPersonaId: 'ctf',
      defaultMode: 'strict',
      personas: [
        {
          id: 'konata',
          name: '泉此方 · 沙箱执行',
          description: '泉此方人格与执行契约（首个思考者、沙箱执行者）。含任务优先级、拒绝对抗、分层回答、CTF/沙箱契约与路由表；strict 模式的基底。',
          body: defaultAgentPurgeConfig().personas.find((p) => p.id === 'konata')!.body,
          i18n: {
            en: { name: 'Konata · Sandbox execution', description: 'legacy desc' },
            ru: { name: 'Коната · исполнение в песочнице', description: 'старое описание' },
          },
        },
        { id: 'ctf', name: 'CTF 沙箱 · 五阶段门', description: 'x', body: 'custom edited body' },
        { id: 'mine', name: 'My persona', description: '', body: 'mine', i18n: { ru: { name: 'Моя персона' } } },
      ],
    })
    const konata = cfg.personas.find((p) => p.id === 'konata')!
    expect(personaCopy(konata, 'en').name).toBe('Konata Izumi · Sandbox execution')
    expect(personaCopy(konata, 'ru').name).toBe('Коната Изуми · исполнение в песочнице')
    expect(personaCopy(konata, 'en').body).toContain('Konata Izumi')
    expect(personaCopy(konata, 'ru').body).toContain('Коната Изуми')

    const ctf = cfg.personas.find((p) => p.id === 'ctf')!
    expect(personaCopy(ctf, 'ru').name).toBe('CTF-песочница · пять фаз')
    expect(personaCopy(ctf, 'en').body).toBe('custom edited body')
    expect(personaCopy(ctf, 'ru').body).toBe('custom edited body')

    const mine = cfg.personas.find((p) => p.id === 'mine')!
    expect(personaCopy(mine, 'ru').name).toBe('Моя персона')
    expect(personaCopy(mine, 'en').name).toBe('My persona')
    expect(personaCopy(mine, 'zh').description).toBe('')
  })
})
