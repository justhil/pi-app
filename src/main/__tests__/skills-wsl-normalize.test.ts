import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentRuntimeConfig } from '../wsl/runtime-config'

const mocks = vi.hoisted(() => {
  const handlers = new Map<string, (req: unknown) => Promise<unknown>>()
  return {
    handlers,
    getAgentRuntimeConfig: vi.fn<() => AgentRuntimeConfig>(),
    isRunning: vi.fn(() => false),
    getSkillsList: vi.fn(),
    getPromptTemplatesList: vi.fn(),
    listSkillsOnDisk: vi.fn(),
    listPromptsOnDisk: vi.fn(() => []),
    listAgentsContextFiles: vi.fn(() => []),
    listPiBuiltinPromptFiles: vi.fn(() => []),
    listPluginInjectedPromptFiles: vi.fn(() => []),
    getContextPrompts: vi.fn(),
  }
})

vi.mock('electron', () => ({ shell: { openExternal: vi.fn() } }))
vi.mock('../wsl/runtime-config', () => ({ getAgentRuntimeConfig: mocks.getAgentRuntimeConfig }))
vi.mock('../ipc/registry', () => ({
  registerHandler: (channel: string, h: (req: unknown) => Promise<unknown>) => {
    mocks.handlers.set(channel, h)
  },
}))
vi.mock('../worker-manager', () => ({
  workerManager: {
    get isRunning() {
      return mocks.isRunning()
    },
    cwd: '\\\\wsl.localhost\\Ubuntu\\home\\pi\\proj',
    getSkillsList: mocks.getSkillsList,
    getPromptTemplatesList: mocks.getPromptTemplatesList,
    getContextPrompts: mocks.getContextPrompts,
    reloadResources: vi.fn(async () => {}),
  },
}))
vi.mock('../config-store', () => ({
  configStore: {
    get: vi.fn(() => ''),
    getSkillOverrides: vi.fn(() => undefined),
    set: vi.fn(),
  },
}))
vi.mock('../pi-resources-editor', () => ({
  listSkillsOnDisk: mocks.listSkillsOnDisk,
  listPromptsOnDisk: mocks.listPromptsOnDisk,
  readTextFileSafe: vi.fn(async (p: string) => ({ content: 'x', path: p })),
  writeTextFileSafe: vi.fn(async () => {}),
  skillStorageKey: (name: string, filePath?: string) =>
    filePath ? `path:${filePath}` : `name:${name}`,
}))
vi.mock('../pi-prompt-catalog', () => ({
  listAgentsContextFiles: mocks.listAgentsContextFiles,
  listPiBuiltinPromptFiles: mocks.listPiBuiltinPromptFiles,
  listPluginInjectedPromptFiles: mocks.listPluginInjectedPromptFiles,
  groupPromptCatalog: (items: unknown[]) => items,
  getGlobalSystemMd: () => join(tmpdir(), 'pi-system.md'),
}))
vi.mock('../resource-revisions', () => ({
  listRevisions: () => [],
  pushRevision: vi.fn(),
  restoreRevision: vi.fn(),
  readRevision: () => '',
}))

import { registerSkillsResourceHandlers } from '../ipc/handlers/skills-resources'
import { normalizeSkillPath, isSkillEnabled, setSkillEnabledInGlobal } from '../pi-skill-overrides'
import { resolveActiveAgentDir } from '../agent-dir'

const WSL: AgentRuntimeConfig = { mode: 'wsl', distro: 'Ubuntu' }
const HOST: AgentRuntimeConfig = { mode: 'host', distro: null }

let tempDir = ''

beforeEach(() => {
  mocks.handlers.clear()
  mocks.getAgentRuntimeConfig.mockReturnValue(WSL)
  mocks.isRunning.mockReturnValue(true)
  mocks.getSkillsList.mockResolvedValue([])
  mocks.getPromptTemplatesList.mockResolvedValue([])
  tempDir = join(tmpdir(), `pi-skills-wsl-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  mkdirSync(join(tempDir, 'skills'), { recursive: true })
})

afterEach(() => {
  vi.restoreAllMocks()
  mocks.getAgentRuntimeConfig.mockReset()
  rmSync(tempDir, { recursive: true, force: true })
})

describe('normalizeSkillPath (WSL runtime)', () => {
  it('translates worker-side Linux paths to the Windows UNC view', () => {
    expect(normalizeSkillPath('/home/pi/proj/.pi/skills/foo/SKILL.md')).toBe(
      '\\\\wsl.localhost\\Ubuntu\\home\\pi\\proj\\.pi\\skills\\foo\\SKILL.md',
    )
  })

  it('translates /mnt/c paths to drive letters', () => {
    expect(normalizeSkillPath('/mnt/c/Users/pi/x/SKILL.md')).toBe('C:\\Users\\pi\\x\\SKILL.md')
  })

  it('leaves already-Windows paths untouched', () => {
    expect(normalizeSkillPath('C:\\Users\\pi\\x\\SKILL.md')).toBe('C:\\Users\\pi\\x\\SKILL.md')
    expect(normalizeSkillPath('\\\\wsl.localhost\\Ubuntu\\home\\pi\\x\\SKILL.md')).toBe(
      '\\\\wsl.localhost\\Ubuntu\\home\\pi\\x\\SKILL.md',
    )
  })

  it('returns undefined for empty input', () => {
    expect(normalizeSkillPath(undefined)).toBeUndefined()
    expect(normalizeSkillPath('')).toBe('')
  })

  it('is a no-op in host mode', () => {
    mocks.getAgentRuntimeConfig.mockReturnValue(HOST)
    expect(normalizeSkillPath('/home/pi/x/SKILL.md')).toBe('/home/pi/x/SKILL.md')
  })

  it('leaves protocol/virtual paths untouched (pi-desktop://system-prompt-preview)', () => {
    expect(normalizeSkillPath('pi-desktop://system-prompt-preview')).toBe(
      'pi-desktop://system-prompt-preview',
    )
  })

  it('leaves relative paths untouched', () => {
    expect(normalizeSkillPath('skills/foo/SKILL.md')).toBe('skills/foo/SKILL.md')
  })
})

describe('skill overrides keyed by normalized path (WSL runtime)', () => {
  it('setSkillEnabledInGlobal with a Linux path writes the UNC key', () => {
    const overrides = setSkillEnabledInGlobal('foo', '/home/pi/proj/.pi/skills/foo/SKILL.md', false)
    expect(overrides['path:\\\\wsl.localhost\\Ubuntu\\home\\pi\\proj\\.pi\\skills\\foo\\SKILL.md']).toBe(false)
    expect(
      isSkillEnabled('foo', '/home/pi/proj/.pi/skills/foo/SKILL.md', overrides),
    ).toBe(false)
    expect(
      isSkillEnabled('foo', '\\\\wsl.localhost\\Ubuntu\\home\\pi\\proj\\.pi\\skills\\foo\\SKILL.md', overrides),
    ).toBe(false)
  })

  it('re-enabling removes the normalized key', () => {
    const disabled = setSkillEnabledInGlobal('foo', '/home/pi/proj/.pi/skills/foo/SKILL.md', false)
    const enabled = setSkillEnabledInGlobal('foo', '/home/pi/proj/.pi/skills/foo/SKILL.md', true)
    expect(enabled['path:\\\\wsl.localhost\\Ubuntu\\home\\pi\\proj\\.pi\\skills\\foo\\SKILL.md']).toBeUndefined()
    expect(isSkillEnabled('foo', '/home/pi/proj/.pi/skills/foo/SKILL.md', enabled)).toBe(true)
    expect(isSkillEnabled('foo', '\\\\wsl.localhost\\Ubuntu\\home\\pi\\proj\\.pi\\skills\\foo\\SKILL.md', enabled)).toBe(
      true,
    )
  })

  it('disabling with the UNC view is honored for worker Linux paths', () => {
    const overrides = setSkillEnabledInGlobal('bar', '\\\\wsl.localhost\\Ubuntu\\home\\pi\\proj\\.pi\\skills\\bar\\SKILL.md', false)
    expect(isSkillEnabled('bar', '/home/pi/proj/.pi/skills/bar/SKILL.md', overrides)).toBe(false)
  })
})

describe('ipc:skills.list merges worker rows with disk rows (WSL runtime)', () => {
  it('merges a worker Linux-path row into the disk UNC-path row as a single entry', async () => {
    const diskRow = {
      name: 'review',
      description: 'code review',
      path: '\\\\wsl.localhost\\Ubuntu\\home\\pi\\proj\\.pi\\skills\\review\\SKILL.md',
      source: 'project',
      fileKind: 'skill-md',
    }
    const workerRow = {
      name: 'review',
      description: 'code review (worker)',
      path: '/home/pi/proj/.pi/skills/review/SKILL.md',
      source: 'project',
    }
    mocks.listSkillsOnDisk.mockReturnValue([diskRow])
    mocks.getSkillsList.mockResolvedValue([workerRow])
    registerSkillsResourceHandlers()
    const handler = mocks.handlers.get('ipc:skills.list')!
    const res = (await handler(undefined)) as { skills: Array<{ name: string; path: string; fromWorker?: boolean }> }
    expect(res.skills).toHaveLength(1)
    expect(res.skills[0].name).toBe('review')
    expect(res.skills[0].path).toBe('\\\\wsl.localhost\\Ubuntu\\home\\pi\\proj\\.pi\\skills\\review\\SKILL.md')
    expect(res.skills[0].fromWorker).toBe(true)
  })

  it('keeps worker-only skills with the normalized UNC path', async () => {
    mocks.listSkillsOnDisk.mockReturnValue([])
    mocks.getSkillsList.mockResolvedValue([
      { name: 'extra', path: '/home/pi/proj/.pi/skills/extra/SKILL.md', source: 'project' },
    ])
    registerSkillsResourceHandlers()
    const handler = mocks.handlers.get('ipc:skills.list')!
    const res = (await handler(undefined)) as { skills: Array<{ name: string; path: string }> }
    expect(res.skills).toHaveLength(1)
    expect(res.skills[0].path).toBe('\\\\wsl.localhost\\Ubuntu\\home\\pi\\proj\\.pi\\skills\\extra\\SKILL.md')
  })

  it('disabled worker skill shows enabled=false (key matches the disk view)', async () => {
    mocks.listSkillsOnDisk.mockReturnValue([])
    mocks.getSkillsList.mockResolvedValue([
      { name: 'x', path: '/home/pi/proj/.pi/skills/x/SKILL.md', source: 'project' },
    ])
    setSkillEnabledInGlobal('x', '/home/pi/proj/.pi/skills/x/SKILL.md', false)
    registerSkillsResourceHandlers()
    const handler = mocks.handlers.get('ipc:skills.list')!
    const res = (await handler(undefined)) as { skills: Array<{ name: string; enabled: boolean }> }
    expect(res.skills[0].enabled).toBe(false)
  })
})
