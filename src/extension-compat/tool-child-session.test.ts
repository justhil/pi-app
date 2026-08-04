import { describe, expect, it } from 'vitest'
import { dirname, join, resolve } from 'node:path'
import { enrichToolChildSessionFiles } from './tool-child-session'

describe('enrichToolChildSessionFiles', () => {
  it('should_derive_live_child_session_files_from_adapter_run_metadata', () => {
    const parentSessionFile = resolve('sessions', 'parent.jsonl')
    const expectedChildSessionFile = join(
      dirname(parentSessionFile),
      'parent',
      'run-1234',
      'run-2',
      'session.jsonl',
    )
    const details = enrichToolChildSessionFiles(
      'subagent',
      parentSessionFile,
      {
        runId: 'run-1234',
        results: [
          {
            agent: 'scout',
            progress: { index: 2, status: 'running' },
          },
        ],
        progress: [
          {
            index: 2,
            agent: 'scout',
            status: 'running',
          },
        ],
      },
    )

    expect(details).toMatchObject({
      results: [
        expect.objectContaining({
          sessionFile: expectedChildSessionFile,
        }),
      ],
      progress: [
        expect.objectContaining({
          sessionFile: expectedChildSessionFile,
        }),
      ],
    })
  })

  it('should_preserve_an_explicit_child_session_file_from_the_extension', () => {
    const explicitSessionFile = resolve('custom', 'child.jsonl')
    const details = {
      runId: 'run-1234',
      results: [
        {
          agent: 'scout',
          sessionFile: explicitSessionFile,
          progress: { index: 0, status: 'running' },
        },
      ],
    }

    expect(enrichToolChildSessionFiles(
      'subagent',
      resolve('sessions', 'parent.jsonl'),
      details,
    )).toBe(details)
  })

  it('should_ignore_unsafe_run_ids_in_adapter_payloads', () => {
    const details = {
      runId: '..\\outside',
      results: [{ agent: 'scout', progress: { index: 0, status: 'running' } }],
    }

    expect(enrichToolChildSessionFiles(
      'subagent',
      resolve('sessions', 'parent.jsonl'),
      details,
    )).toBe(details)
  })
})
