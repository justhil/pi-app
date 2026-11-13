import { describe, expect, it } from 'vitest'
import {
  defaultAgentPurgeConfig,
  normalizeAgentPurgeConfig,
  parsePersonaMarkdown,
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
})
