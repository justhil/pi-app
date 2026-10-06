import { describe, expect, it } from 'vitest'
import { parseUnifiedDiff } from '../diff-model'

describe('parseUnifiedDiff', () => {
  it('handles renames, deletions and quoted non-ASCII paths', () => {
    const raw = [
      'diff --git a/old.ts b/new.ts',
      'similarity index 90%',
      'rename from old.ts',
      'rename to new.ts',
      'diff --git a/gone.ts b/gone.ts',
      'deleted file mode 100644',
      '--- a/gone.ts',
      '+++ /dev/null',
      '@@ -1,2 +0,0 @@',
      '-a',
      '-b',
      'diff --git "a/\\344\\270\\255.md" "b/\\344\\270\\255.md"',
      '--- "a/\\344\\270\\255.md"',
      '+++ "b/\\344\\270\\255.md"',
      '@@ -1 +1 @@',
      '-x',
      '+y',
    ].join('\n')
    const files = parseUnifiedDiff(raw)
    expect(files.map(({ lines: _l, ...f }) => f)).toEqual([
      { path: 'new.ts', add: 0, del: 0, status: 'renamed' },
      { path: 'gone.ts', add: 0, del: 2, status: 'deleted' },
      { path: '中.md', add: 1, del: 1, status: 'modified' },
    ])
    expect(files[1].lines).toEqual([
      { k: 'del', o: 1, s: 'a' },
      { k: 'del', o: 2, s: 'b' },
    ])
  })
})
