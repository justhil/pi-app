import { describe, expect, it } from 'vitest'
import { filterBySearch } from './file-tree-folder-contents'
import type { FsEntry } from './workspace-files-types'

const src: FsEntry = { name: 'src', path: 'src', isDirectory: true }
const index: FsEntry = { name: 'index.ts', path: 'src/index.ts', isDirectory: false }

describe('filterBySearch', () => {
  it('should_keep_folder_when_searching_inside_it', () => {
    expect(filterBySearch([src], 'src/')).toEqual([src])
    expect(filterBySearch([index], 'src/')).toEqual([index])
  })
})
