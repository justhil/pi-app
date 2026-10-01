import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { flattenTreeFromSessionFile } from './session-tree-from-file'

const temporaryDirectories: string[] = []

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('session tree leaf override', () => {
  it('preserves explicit null as the root instead of falling back to the final disk entry', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'pi-session-tree-'))
    temporaryDirectories.push(directory)
    const sessionFile = join(directory, 'session.jsonl')
    const entries = [
      { type: 'session', version: 3, id: 'session-1', cwd: directory },
      { type: 'message', id: 'user-1', parentId: null, message: { role: 'user', content: 'hello' } },
      { type: 'message', id: 'assistant-1', parentId: 'user-1', message: { role: 'assistant', content: 'world' } },
    ]
    writeFileSync(sessionFile, `${entries.map((entry) => JSON.stringify(entry)).join('\n')}\n`, 'utf8')

    const tree = await flattenTreeFromSessionFile(sessionFile, directory, null)

    expect(tree.leafId).toBeNull()
    expect(tree.nodes.every((node) => !node.isLeaf)).toBe(true)
  })
})

describe('session tree previews', () => {
  it('should_strip_ansi_when_tool_output_is_colored', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'pi-session-tree-'))
    temporaryDirectories.push(directory)
    const sessionFile = join(directory, 'session.jsonl')
    const entries = [
      { type: 'session', version: 3, id: 'session-1', cwd: directory },
      { type: 'message', id: 'user-1', parentId: null, message: { role: 'user', content: 'run tests' } },
      { type: 'message', id: 'tool-1', parentId: 'user-1', message: { role: 'toolResult', toolName: 'bash', content: '\u001b[32m✔ parses plain links\u001b[39m' } },
    ]
    writeFileSync(sessionFile, `${entries.map((entry) => JSON.stringify(entry)).join('\n')}\n`, 'utf8')

    const tree = await flattenTreeFromSessionFile(sessionFile, directory)

    expect(tree.nodes.find((node) => node.id === 'tool-1')?.preview).toBe('✔ parses plain links')
  })
})
