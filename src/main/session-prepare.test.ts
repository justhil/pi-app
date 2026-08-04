import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { resolvePreparedSessionFile } from './session-prepare'

const temporaryDirectories: string[] = []

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('resolvePreparedSessionFile', () => {
  it('should_keep_direct_child_session_file_when_header_is_already_available', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'pi-child-direct-'))
    temporaryDirectories.push(directory)
    const childSessionFile = join(directory, 'session.jsonl')
    writeFileSync(childSessionFile, `${JSON.stringify({
      type: 'session',
      id: 'direct-child-session',
      cwd: '/workspace',
    })}\n`)
    const listSessions = vi.fn()

    await expect(resolvePreparedSessionFile(childSessionFile, listSessions)).resolves.toEqual({
      sessionId: 'direct-child-session',
      sessionFile: childSessionFile,
    })
    expect(listSessions).not.toHaveBeenCalled()
  })

  it('should_resolve_forked_child_session_from_adapter_candidate_path', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'pi-child-prepare-'))
    temporaryDirectories.push(directory)
    const parentSessionFile = join(directory, 'parent.jsonl')
    const resolvedSessionFile = join(directory, 'forked-child.jsonl')
    writeFileSync(parentSessionFile, `${JSON.stringify({
      type: 'session',
      id: 'parent-session',
      cwd: '/workspace',
    })}\n`)
    writeFileSync(resolvedSessionFile, `${JSON.stringify({
      type: 'session',
      id: 'forked-child-session',
      cwd: '/workspace',
    })}\n`)
    const candidateSessionFile = join(
      directory,
      'parent',
      'run-live',
      'run-0',
      'session.jsonl',
    )
    const listSessions = vi.fn().mockResolvedValue([
      {
        id: 'forked-child-session',
        path: resolvedSessionFile,
        cwd: '/workspace',
        name: 'subagent-worker-run-live-1',
      },
    ])

    await expect(resolvePreparedSessionFile(candidateSessionFile, listSessions)).resolves.toEqual({
      sessionId: 'forked-child-session',
      sessionFile: resolvedSessionFile,
    })
    expect(listSessions).toHaveBeenCalledWith('/workspace')
  })
})
