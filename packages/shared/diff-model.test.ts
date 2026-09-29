import { describe, expect, it } from 'vitest'
import { parseGitDiff } from './diff-model'

describe('parseGitDiff', () => {
  it('should_parse_modified_hunks', () => {
    const files = parseGitDiff(
      [
        'diff --git a/src/a.ts b/src/a.ts',
        '--- a/src/a.ts',
        '+++ b/src/a.ts',
        '@@ -1,2 +1,2 @@',
        ' keep',
        '-old',
        '+new',
        '',
      ].join('\n'),
    )
    expect(files).toHaveLength(1)
    expect(files[0]?.path).toBe('src/a.ts')
    expect(files[0]?.status).toBe('modified')
    expect(files[0]?.additions).toBe(1)
    expect(files[0]?.deletions).toBe(1)
    expect(files[0]?.hunks[0]?.patch).toContain('diff --git')
  })

  it('should_keep_binary_and_rename_without_hunks', () => {
    const files = parseGitDiff(
      [
        'diff --git a/x.bin b/x.bin',
        'new file mode 100644',
        'Binary files /dev/null and b/x.bin differ',
        'diff --git a/old.ts b/new.ts',
        'similarity index 100%',
        'rename from old.ts',
        'rename to new.ts',
        '',
      ].join('\n'),
    )
    expect(files.map((f) => [f.path, f.status, f.binary, f.hunks.length])).toEqual([
      ['x.bin', 'added', true, 0],
      ['new.ts', 'renamed', false, 0],
    ])
    expect(files[1]?.oldPath).toBe('old.ts')
  })

  it('should_unquote_paths', () => {
    const files = parseGitDiff(
      [
        'diff --git "a/foo bar.ts" "b/foo bar.ts"',
        '--- "a/foo bar.ts"',
        '+++ "b/foo bar.ts"',
        '@@ -1 +1 @@',
        '-a',
        '+b',
        '',
      ].join('\n'),
    )
    expect(files[0]?.path).toBe('foo bar.ts')
  })
})
