import { describe, expect, it } from 'vitest'
import { projectFolderOrder } from './project-folder-order'

describe('projectFolderOrder', () => {
  it('MRU mode (default): pins the current workspace to the top, then stored order', () => {
    expect(projectFolderOrder(['a', 'b', 'c'], 'b', false)).toEqual(['b', 'a', 'c'])
    expect(projectFolderOrder(['a', 'c'], 'b', false)).toEqual(['b', 'a', 'c'])
    expect(projectFolderOrder([], 'b', false)).toEqual(['b'])
  })

  it('fixed mode: keeps the stored order and never pins the current workspace', () => {
    expect(projectFolderOrder(['a', 'b', 'c'], 'b', true)).toEqual(['a', 'b', 'c'])
    // 当前项目不在列表时追加到末尾（仅保证存在，不置顶）
    expect(projectFolderOrder(['a', 'c'], 'b', true)).toEqual(['a', 'c', 'b'])
    expect(projectFolderOrder([], 'b', true)).toEqual(['b'])
  })

  it('dedupes and ignores falsy entries', () => {
    expect(projectFolderOrder(['a', 'a', 'b'], 'a', false)).toEqual(['a', 'b'])
    expect(projectFolderOrder(['a', 'b'], null, false)).toEqual(['a', 'b'])
    expect(projectFolderOrder(['', 'a'], null, true)).toEqual(['a'])
  })
})
