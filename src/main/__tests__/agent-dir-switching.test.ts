import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

const tempDirs: string[] = []

function createTempAgentDir(): string {
  const dir = join(tmpdir(), `pi-agent-switch-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  mkdirSync(join(dir, 'sessions'), { recursive: true })
  tempDirs.push(dir)
  return dir
}

let activeAgentDir = ''

vi.mock('../agent-dir', () => ({
  resolveActiveAgentDir: () => activeAgentDir,
  resolveActiveAgentSettingsFile: () => join(activeAgentDir, 'settings.json'),
}))

import { getModelsJsonPath } from '../pi-models-json'
import { readPiInfo } from '../pi-info'
import { listRevisions, pushRevision } from '../resource-revisions'
import { listMissingRuntimePackages } from '../pi-packages-sync'
import { clearWorkspaceFileSearchCaches, resolveFdExecutable } from '../workspace-file-search'

afterEach(() => {
  activeAgentDir = ''
  clearWorkspaceFileSearchCaches()
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('agent dir switching (WSL runtime)', () => {
  it('getModelsJsonPath resolves under the active agent dir', () => {
    const agentDir = createTempAgentDir()
    activeAgentDir = agentDir
    expect(getModelsJsonPath()).toBe(join(agentDir, 'models.json'))
  })

  it('readPiInfo resolves agent dir, sessions, settings and models under the active agent dir', () => {
    const agentDir = createTempAgentDir()
    activeAgentDir = agentDir
    const info = readPiInfo()
    expect(info.agentDir).toBe(agentDir)
    expect(info.sessionDir).toBe(join(agentDir, 'sessions'))
    expect(info.settingsFile).toBe(join(agentDir, 'settings.json'))
    expect(info.modelsFile).toBe(join(agentDir, 'models.json'))
  })

  it('resource revisions are stored under the active agent dir', () => {
    const agentDir = createTempAgentDir()
    activeAgentDir = agentDir
    const dir = join(agentDir, 'skills')
    mkdirSync(dir, { recursive: true })
    const file = join(dir, 'sample.md')
    writeFileSync(file, '# v1\n', 'utf8')
    try {
      const entry = pushRevision(file, '保存前')
      expect(entry).not.toBeNull()
      const revisions = listRevisions(file)
      expect(revisions.length).toBe(1)
      expect(revisions[0].label).toBe('保存前')
    } finally {
      activeAgentDir = ''
    }
  })

  it('pi-packages-sync reads settings from the active agent dir', () => {
    const agentDir = createTempAgentDir()
    writeFileSync(join(agentDir, 'settings.json'), JSON.stringify({ packages: ['pi-image-gen'] }), 'utf8')
    activeAgentDir = agentDir
    try {
      expect(listMissingRuntimePackages()).toEqual([])
    } finally {
      activeAgentDir = ''
    }
  })

  it('workspace file search uses the pi-managed fd under the active agent dir', async () => {
    const agentDir = createTempAgentDir()
    const binDir = join(agentDir, 'bin')
    mkdirSync(binDir, { recursive: true })
    const managed = join(binDir, process.platform === 'win32' ? 'fd.exe' : 'fd')
    writeFileSync(managed, '')
    activeAgentDir = agentDir
    try {
      expect(await resolveFdExecutable()).toBe(managed)
    } finally {
      activeAgentDir = ''
    }
  })
})
