import { describe, expect, it } from 'vitest'
import {
  computeMutateCallDiffStats,
  mergeCodemodeNestedCalls,
  parseCodemodeCalls,
  sumCodemodeDiffStats,
  toolCallDetailFromPi,
} from './tool-call-detail'

describe('toolCallDetailFromPi', () => {
  it('maps bash', () => {
    const d = toolCallDetailFromPi('bash', { command: 'ls' }, 'out')
    expect(d).toEqual({ type: 'bash', command: 'ls', output: 'out' })
  })

  it('maps edit with edits array', () => {
    const d = toolCallDetailFromPi('edit', { path: 'a.ts', edits: [{ oldText: 'x', newText: 'y' }] }, '')
    expect(d.type).toBe('edit')
    if (d.type === 'edit') {
      expect(d.path).toBe('a.ts')
      expect(d.edits).toHaveLength(1)
    }
  })
})

describe('codemode edit/write diff stats', () => {
  it('should_compute_diff_stats_from_pi_nestedCalls_when_call_args_is_truncated_at_200_chars', () => {
    const longNew = Array.from({ length: 12 }, (_, i) => `const line${i} = ${i};`).join('\n')
    const rawDetails = {
      calls: [
        {
          id: 'cm-1/1',
          name: 'edit',
          args: '{"path":"src/foo.ts","edits":[{"oldText":"const line0 = 0;\\nconst old = true;","newText":"const line0 = 0;\\n' + longNew.slice(0, 80) + '...',
          status: 'ok',
          durationMs: 14,
        },
        {
          id: 'cm-1/2',
          name: 'write',
          args: '{"path":"src/new.ts","content":"a\\nb\\nc\\n"}',
          status: 'ok',
          durationMs: 8,
        },
      ],
    }
    const nestedCalls = {
      calls: [
        {
          id: 'cm-1/1',
          name: 'edit',
          status: 'ok',
          arguments: {
            path: 'src/foo.ts',
            edits: [{ oldText: 'const line0 = 0;\nconst old = true;', newText: longNew }],
          },
        },
        {
          id: 'cm-1/2',
          name: 'write',
          status: 'ok',
          arguments: {
            path: 'src/new.ts',
            content: 'a\nb\nc\n',
          },
        },
      ],
      complete: true,
    }

    const merged = mergeCodemodeNestedCalls(rawDetails, nestedCalls)
    const calls = parseCodemodeCalls(merged)
    expect(calls[0]).toMatchObject({
      path: 'src/foo.ts',
      additions: 11,
      deletions: 1,
    })
    expect(calls[1]).toMatchObject({
      path: 'src/new.ts',
      additions: 3,
      deletions: 0,
    })
    expect(sumCodemodeDiffStats(calls)).toEqual({ additions: 14, deletions: 1 })
  })

  it('should_fall_back_to_script_code_literals_when_arguments_exceed_nestedCalls_cap', () => {
    const code = [
      'await tools.write({',
      '  path: "src/generated.ts",',
      '  content: "line1\\nline2\\nline3\\nline4"',
      '});',
    ].join('\n')
    const calls = parseCodemodeCalls(
      {
        calls: [
          {
            id: 'cm-2/1',
            name: 'write',
            args: '{"path":"src/generated.ts","content":"line1\\nline2...',
            status: 'ok',
          },
        ],
      },
      code,
    )
    expect(calls[0]).toMatchObject({ path: 'src/generated.ts', additions: 4, deletions: 0 })
  })

  it('should_prefer_patch_lines_in_computeMutateCallDiffStats', () => {
    const stats = computeMutateCallDiffStats(
      'edit',
      { path: 'src/a.ts', edits: [{ oldText: 'a', newText: 'b' }] },
      { patch: '--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1,2 +1,3 @@\n keep\n-old\n+new1\n+new2\n' },
    )
    expect(stats).toEqual({ path: 'src/a.ts', additions: 2, deletions: 1 })
  })
})
