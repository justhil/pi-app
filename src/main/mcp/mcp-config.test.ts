import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { checkServer, parseImport, patchServer, readMcpConfig, removeServer, saveServer, setAutoEnableCodemode } from './mcp-config'

let root: string
let agentDir: string
let project: string
const json = (p: string) => JSON.parse(readFileSync(p, 'utf8'))

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'mcp-config-'))
  agentDir = join(root, 'agent')
  project = join(root, 'proj')
  mkdirSync(agentDir, { recursive: true })
  mkdirSync(join(project, '.pi'), { recursive: true })
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

describe('mcp config', () => {
  it('merges project overrides over global servers and lists project servers', () => {
    writeFileSync(join(agentDir, 'mcp.json'), JSON.stringify({ mcpServers: { docs: { url: 'https://d.test/mcp', headers: { A: 'b' } }, fs: { command: 'npx' } } }))
    writeFileSync(join(project, '.pi', 'mcp.json'), JSON.stringify({ autoEnableCodemode: false, mcpServers: { docs: { enabled: false }, local: { command: 'node', args: ['s.js'] } } }))
    const view = readMcpConfig({ agentDir, project, projectTrusted: true })
    expect(view.servers.map((s) => [s.name, s.scope])).toEqual([['docs', 'global'], ['fs', 'global'], ['local', 'project']])
    expect(view.servers[0].config).toEqual({ url: 'https://d.test/mcp', headers: { A: 'b' }, enabled: false })
    expect(view.servers[0].override).toEqual({ enabled: false })
    expect(view.autoEnableCodemode).toBe(false)
    expect(readMcpConfig({ agentDir, project, projectTrusted: false }).servers).toHaveLength(2)
  })

  it('saves, renames and removes servers keeping other content', () => {
    const path = join(agentDir, 'mcp.json')
    writeFileSync(path, JSON.stringify({ mine: 1, mcpServers: { a: { command: 'x' } } }))
    saveServer(path, 'b', { command: 'y', args: ['1'] }, 'a')
    expect(json(path)).toEqual({ mine: 1, mcpServers: { b: { command: 'y', args: ['1'] } } })
    expect(() => saveServer(path, 'bad name', { command: 'y' })).toThrow(/name/)
    expect(() => saveServer(path, 'c', { command: 'y', url: 'https://x' })).toThrow(/either/)
    expect(removeServer(path, 'b')).toBe(true)
    expect(removeServer(path, 'b')).toBe(false)
  })

  it('patches definitions dropping defaults and writes / clears project overrides', () => {
    const g = join(agentDir, 'mcp.json')
    const p = join(project, '.pi', 'mcp.json')
    writeFileSync(g, JSON.stringify({ mcpServers: { a: { command: 'x', exposure: 'direct' } } }))
    patchServer(g, 'a', { exposure: 'codemode', enabled: false })
    expect(json(g).mcpServers.a).toEqual({ command: 'x', enabled: false })
    patchServer(p, 'a', { enabled: true }, { override: true })
    expect(json(p).mcpServers.a).toEqual({ enabled: true })
    patchServer(p, 'a', { enabled: undefined }, { override: true })
    expect(json(p).mcpServers).toEqual({})
  })

  it('toggles autoEnableCodemode', () => {
    const g = join(agentDir, 'mcp.json')
    setAutoEnableCodemode(g, false)
    expect(json(g)).toEqual({ autoEnableCodemode: false })
    setAutoEnableCodemode(g, true)
    expect(json(g)).toEqual({})
  })

  it('imports configs from other clients', () => {
    const r = parseImport(JSON.stringify({ servers: { gh: { type: 'http', url: 'https://g.test/mcp' }, bad: { command: 'a', url: 'https://b' }, old: { type: 'sse', url: 'https://o' } } }))
    expect(r.servers).toEqual({ gh: { url: 'https://g.test/mcp' } })
    expect(r.problems).toHaveLength(2)
    expect(parseImport('{').problems).toHaveLength(1)
    expect(checkServer('ok', { url: 'ftp://x' })).toEqual(['url: must start with http:// or https://'])
  })
})
