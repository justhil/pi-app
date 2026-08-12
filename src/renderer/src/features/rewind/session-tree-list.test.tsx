import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  SessionTreeList,
  resolveViewTargetId,
  type SessionTreeNode,
} from './session-tree-list'

const userNode: SessionTreeNode = {
  id: 'user-1',
  depth: 0,
  entryType: 'message',
  role: 'user',
  preview: 'historical user input',
  isLeaf: false,
}

function renderTree(node = userNode, extra: { viewOnSingleClick?: boolean } = {}) {
  const onSelect = vi.fn()
  const onActivate = vi.fn()
  const onView = vi.fn()
  render(
    <SessionTreeList
      nodes={[node]}
      onSelect={onSelect}
      onActivate={onActivate}
      onView={onView}
      showGuides={false}
      viewOnSingleClick={extra.viewOnSingleClick}
    />,
  )
  return { onSelect, onActivate, onView }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('SessionTreeList view and rewind actions', () => {
  it('single click only selects by default', () => {
    const { onSelect, onActivate, onView } = renderTree()

    fireEvent.click(screen.getByRole('button', { name: /historical user input/i }))

    expect(onSelect).toHaveBeenCalledWith('user-1')
    expect(onActivate).not.toHaveBeenCalled()
    expect(onView).not.toHaveBeenCalled()
  })

  it('single click views a non-leaf node when viewOnSingleClick is set', () => {
    const { onSelect, onView } = renderTree(userNode, { viewOnSingleClick: true })
    vi.useFakeTimers()

    fireEvent.click(screen.getByRole('button', { name: /historical user input/i }))

    expect(onSelect).toHaveBeenCalledWith('user-1')
    expect(onView).not.toHaveBeenCalled()

    act(() => vi.advanceTimersByTime(250))
    expect(onView).toHaveBeenCalledOnce()
    expect(onView).toHaveBeenCalledWith('user-1')
  })

  it('double click cancels the pending view and rewinds once', () => {
    const { onActivate, onView } = renderTree(userNode, { viewOnSingleClick: true })
    vi.useFakeTimers()
    const row = screen.getByRole('button', { name: /historical user input/i })

    fireEvent.click(row)
    fireEvent.click(row)
    fireEvent.doubleClick(row)

    act(() => vi.advanceTimersByTime(250))
    expect(onView).not.toHaveBeenCalled()
    expect(onActivate).toHaveBeenCalledOnce()
    expect(onActivate).toHaveBeenCalledWith('user-1')
  })

  it('a quick second click on another node overrides the pending view', () => {
    const other: SessionTreeNode = {
      id: 'user-2',
      depth: 0,
      entryType: 'message',
      role: 'user',
      preview: 'later user input',
      isLeaf: false,
    }
    const onView = vi.fn()
    render(
      <SessionTreeList
        nodes={[userNode, other]}
        onSelect={() => {}}
        onActivate={() => {}}
        onView={onView}
        showGuides={false}
        viewOnSingleClick
      />,
    )
    vi.useFakeTimers()

    fireEvent.click(screen.getByRole('button', { name: /historical user input/i }))
    fireEvent.click(screen.getByRole('button', { name: /later user input/i }))

    act(() => vi.advanceTimersByTime(250))
    expect(onView).toHaveBeenCalledOnce()
    expect(onView).toHaveBeenCalledWith('user-2')
  })

  it('never views or rewinds the current leaf', () => {
    const { onActivate, onView } = renderTree({ ...userNode, isLeaf: true }, { viewOnSingleClick: true })
    const row = screen.getByRole('button', { name: /historical user input/i })

    fireEvent.click(row)
    fireEvent.doubleClick(row)

    expect(onView).not.toHaveBeenCalled()
    expect(onActivate).not.toHaveBeenCalled()
  })
})

describe('resolveViewTargetId', () => {
  const toolNode = (id: string): SessionTreeNode => ({
    id,
    depth: 0,
    entryType: 'tool',
    isLeaf: false,
  })
  const msgNode = (id: string): SessionTreeNode => ({
    id,
    depth: 0,
    entryType: 'message',
    role: 'user',
    isLeaf: false,
  })

  it('message nodes view themselves', () => {
    const nodes = [msgNode('m1'), msgNode('m2')]
    expect(resolveViewTargetId(nodes, 0)).toBe('m1')
    expect(resolveViewTargetId(nodes, 1)).toBe('m2')
  })

  it('tool nodes view the next message (the reply that used the tool)', () => {
    const nodes = [msgNode('m1'), toolNode('t1'), msgNode('m2'), msgNode('m3')]
    expect(resolveViewTargetId(nodes, 1)).toBe('m2')
  })

  it('falls back to the previous message when none follows', () => {
    const nodes = [msgNode('m1'), toolNode('t1')]
    expect(resolveViewTargetId(nodes, 1)).toBe('m1')
  })

  it('toolResult messages resolve to a landable message instead of their merged id', () => {
    // toolResult 的 entryType 也是 message，但时间线合并进前一条 assistant 工具行，
    // 没有自己的锚点——必须解析到最近的可见消息
    const toolResultNode = (id: string): SessionTreeNode => ({
      id,
      depth: 0,
      entryType: 'message',
      role: 'toolResult',
      isLeaf: false,
    })
    const assistant = (id: string): SessionTreeNode => ({
      id,
      depth: 0,
      entryType: 'message',
      role: 'assistant',
      isLeaf: false,
    })

    const nodes = [assistant('a1'), toolResultNode('r1'), assistant('a2')]
    // 前一条 assistant 工具行仍在树中：优先解析到它
    expect(resolveViewTargetId(nodes, 1)).toBe('a1')
    // 无更早消息时回退到下一条可见消息
    const nodes2 = [toolResultNode('r1'), assistant('a2')]
    expect(resolveViewTargetId(nodes2, 0)).toBe('a2')
  })
})
