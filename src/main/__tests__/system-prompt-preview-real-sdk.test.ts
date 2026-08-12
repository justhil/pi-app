import { mkdtempSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as sdk from '@earendil-works/pi-coding-agent'
import { buildSystemPromptPreview } from '../system-prompt-preview'

const tempRoots: string[] = []
afterEach(() => {
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true })
  vi.unstubAllGlobals()
})

describe('buildSystemPromptPreview with the real SDK', () => {
  it('includes project resources without writing agent files or using network', async () => {
    const root = mkdtempSync(join(tmpdir(), 'pi-system-prompt-preview-'))
    tempRoots.push(root)
    const agentDir = join(root, 'agent')
    const cwd = join(root, 'repo')
    mkdirSync(agentDir)
    mkdirSync(join(cwd, '.pi', 'custom-skill'), { recursive: true })
    writeFileSync(join(cwd, '.pi', 'SYSTEM.md'), 'PROJECT_SYSTEM_SENTINEL')
    writeFileSync(join(cwd, '.pi', 'APPEND_SYSTEM.md'), 'PROJECT_APPEND_SENTINEL')
    writeFileSync(
      join(cwd, '.pi', 'custom-skill', 'SKILL.md'),
      '---\nname: configured-only\ndescription: CONFIGURED_SKILL_SENTINEL\n---\nBody',
    )
    const beforeAgent = readdirSync(agentDir)
    const beforeProject = readdirSync(join(cwd, '.pi'))
    const fetch = vi.fn(async () => { throw new Error('network forbidden') })
    vi.stubGlobal('fetch', fetch)

    const prompt = await buildSystemPromptPreview(
      { ...sdk, getAgentDir: () => agentDir } as unknown as Parameters<typeof buildSystemPromptPreview>[0],
      cwd,
      {},
      { skills: ['custom-skill'], packages: ['npm:must-not-install'] },
    )

    expect(prompt).toContain('PROJECT_SYSTEM_SENTINEL')
    expect(prompt).toContain('PROJECT_APPEND_SENTINEL')
    expect(prompt).toContain('configured-only')
    expect(fetch).not.toHaveBeenCalled()
    expect(readdirSync(agentDir)).toEqual(beforeAgent)
    expect(readdirSync(join(cwd, '.pi'))).toEqual(beforeProject)
  })
})
