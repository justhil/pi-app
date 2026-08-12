import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  resolveActiveAgentDir: vi.fn(() => ''),
  resolveActiveHomeDir: vi.fn(() => ''),
}))

vi.mock('../agent-dir', () => ({
  resolveActiveAgentDir: mocks.resolveActiveAgentDir,
  resolveActiveHomeDir: mocks.resolveActiveHomeDir,
}))

import { listSkillsOnDisk, listPromptsOnDisk } from '../pi-resources-editor'

describe('listSkillsOnDisk 顶层 ~/.pi/skills 扫描', () => {
  const root = join(tmpdir(), `pi-resources-editor-test-${process.pid}`)
  const home = join(root, 'home')
  const agentDir = join(home, '.pi', 'agent')
  const cwd = join(root, 'proj')

  beforeEach(() => {
    mkdirSync(join(cwd, '.pi', 'skills', 'proj-skill'), { recursive: true })
    mkdirSync(join(agentDir, 'skills', 'agent-skill'), { recursive: true })
    mkdirSync(join(home, '.pi', 'skills', 'home-skill'), { recursive: true })
    writeFileSync(join(cwd, '.pi', 'skills', 'proj-skill', 'SKILL.md'), '---\ndescription: proj\n---\nbody')
    writeFileSync(join(agentDir, 'skills', 'agent-skill', 'SKILL.md'), '---\ndescription: agent\n---\nbody')
    writeFileSync(join(home, '.pi', 'skills', 'home-skill', 'SKILL.md'), '---\ndescription: home\n---\nbody')
    mocks.resolveActiveAgentDir.mockReturnValue(agentDir)
    mocks.resolveActiveHomeDir.mockReturnValue(home)
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
    vi.clearAllMocks()
  })

  it('同时扫到 cwd 项目级、agent 全局级与 ~/.pi/skills 顶层全局级 skills', () => {
    const skills = listSkillsOnDisk(cwd)
    const names = skills.map((s) => s.name).sort()
    expect(names).toEqual(['agent-skill', 'home-skill', 'proj-skill'])
    const homeSkill = skills.find((s) => s.name === 'home-skill')
    expect(homeSkill?.source).toBe('global')
    expect(homeSkill?.path.replace(/\\/g, '/')).toContain('.pi/skills/home-skill/SKILL.md')
  })

  it('cwd=home 时项目级与顶层 ~/.pi/skills 同路径去重', () => {
    const skills = listSkillsOnDisk(home)
    expect(skills.filter((s) => s.name === 'home-skill')).toHaveLength(1)
    expect(skills.map((s) => s.name).sort()).toEqual(['agent-skill', 'home-skill'])
  })

  it('顶层目录不存在时不影响其他来源', () => {
    mocks.resolveActiveHomeDir.mockReturnValue(join(root, 'no-such-home'))
    const skills = listSkillsOnDisk(cwd)
    expect(skills.map((s) => s.name).sort()).toEqual(['agent-skill', 'proj-skill'])
  })

  it('prompts 也兼容 ~/.pi/prompts 顶层', () => {
    mkdirSync(join(home, '.pi', 'prompts'), { recursive: true })
    writeFileSync(join(home, '.pi', 'prompts', 'hi.md'), 'hello')
    const prompts = listPromptsOnDisk(cwd)
    expect(prompts.some((p) => p.name === 'hi')).toBe(true)
  })
})
