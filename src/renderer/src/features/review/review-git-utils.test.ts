import { describe, expect, it } from 'vitest'
import { parseGitDiff } from '@shared/diff-model'
import {
  collectTouchedPaths,
  filterReviewGroups,
  groupReviewFiles,
  listConflictPaths,
  parseGitStatus,
} from './review-git-utils'

const quoted = '"\\344\\270\\255\\346\\226\\207.txt"'
it('decodes Git UTF-8 octal paths for status, conflicts and diff', () => {
  expect(parseGitStatus(` M ${quoted}\nUU ${quoted}`).map(row => row.path)).toEqual(['中文.txt', '中文.txt'])
  expect(listConflictPaths(`UU ${quoted}`)).toEqual(['中文.txt'])
  expect(parseGitDiff(`diff --git "a/${quoted.slice(1)} "b/${quoted.slice(1)}\n--- "a/${quoted.slice(1)}\n+++ "b/${quoted.slice(1)}\n@@ -1 +1 @@\n-a\n+b\n`)[0].path).toBe('中文.txt')
})
it('keeps a literal arrow inside a quoted filename when parsing renames', () => {
  expect(parseGitStatus('R  "old -> name.txt" -> "new -> name.txt"')[0].path).toBe('new -> name.txt')
})

describe('listConflictPaths', () => {
  it('picks UU/AA/DD rows and ignores ordinary edits', () => {
    const status = [
      '## main',
      'UU src/a.ts',
      ' M src/b.ts',
      'AA src/c.ts',
      '?? src/d.ts',
    ].join('\n')
    expect(listConflictPaths(status)).toEqual(['src/a.ts', 'src/c.ts'])
    expect(parseGitStatus(status).map((row) => row.path)).toEqual(['src/a.ts', 'src/b.ts', 'src/c.ts', 'src/d.ts'])
  })
})

describe('session touched path matching', () => {
  it('should_match_windows_paths_case_insensitively_and_ignore_failed_or_other_workspace_tools', () => {
    const touched = collectTouchedPaths(
      [],
      [
        { toolName: 'edit', toolArgs: { path: './src/Foo.ts' } },
        { toolName: 'write', toolArgs: { path: 'd:\\workspace\\pi-app\\src\\Bar.ts' } },
        { toolName: 'edit', isError: true, toolArgs: { path: 'src/Failed.ts' } },
        { toolName: 'write', toolArgs: { path: 'D:\\workspace\\other-repo\\src\\SameName.ts' } },
      ],
      null,
      'D:\\workspace\\pi-app',
    )

    const allGroups = groupReviewFiles({
      status: ' M src/foo.ts\n?? src/bar.ts\n M src/Failed.ts\n M src/SameName.ts\n',
      unstagedRaw: '',
      stagedRaw: '',
    })
    const filtered = filterReviewGroups(allGroups, touched)
    expect(filtered.unstaged.map((r) => r.path)).toEqual(['src/foo.ts', 'src/bar.ts'])
  })
})

