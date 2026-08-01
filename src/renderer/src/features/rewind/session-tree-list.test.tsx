import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { SessionTreeList, type SessionTreeNode } from './session-tree-list'

const userNode: SessionTreeNode = {
  id: 'user-1',
  depth: 0,
  entryType: 'message',
  role: 'user',
  preview: 'historical user input',
  isLeaf: false,
}

function renderTree(node = userNode) {
  const onSelect = vi.fn()
  const onActivate = vi.fn()
  render(
    <SessionTreeList
      nodes={[node]}
      onSelect={onSelect}
      onActivate={onActivate}
      showGuides={false}
    />,
  )
  return { onSelect, onActivate }
}

describe('SessionTreeList view and rewind actions', () => {
  it('single click only selects the historical input for viewing', () => {
    const { onSelect, onActivate } = renderTree()

    fireEvent.click(screen.getByRole('button', { name: /historical user input/i }))

    expect(onSelect).toHaveBeenCalledWith('user-1')
    expect(onActivate).not.toHaveBeenCalled()
  })

  it('double click explicitly activates a non-leaf node', () => {
    const { onActivate } = renderTree()

    fireEvent.doubleClick(screen.getByRole('button', { name: /historical user input/i }))

    expect(onActivate).toHaveBeenCalledWith('user-1')
  })

  it('never activates the current leaf', () => {
    const { onActivate } = renderTree({ ...userNode, isLeaf: true })
    const row = screen.getByRole('button', { name: /historical user input/i })

    fireEvent.click(row)
    fireEvent.doubleClick(row)

    expect(onActivate).not.toHaveBeenCalled()
  })
})
