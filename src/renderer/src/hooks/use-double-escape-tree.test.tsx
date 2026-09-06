import { fireEvent, render, renderHook, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useDoubleEscapeTree } from './use-double-escape-tree'

vi.mock('@renderer/lib/ipc-client', () => ({ ipcClient: { invoke: vi.fn().mockResolvedValue({ settings: {} }) } }))
afterEach(() => vi.restoreAllMocks())

describe('Double Escape routing', () => {
  it('should_not_open_the_tree_when_Escape_is_used_inside_a_dialog', () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(1000)
    const { result } = renderHook(() => useDoubleEscapeTree(true))
    render(<div role="dialog"><button>Close panel</button></div>)
    fireEvent.keyDown(screen.getByRole('button'), { key: 'Escape' })
    clock.mockReturnValue(1100)
    fireEvent.keyDown(screen.getByRole('button'), { key: 'Escape' })
    expect(result.current.treeOpen).toBe(false)
  })

  it('keeps double Escape available outside dialogs', () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(1000)
    const { result } = renderHook(() => useDoubleEscapeTree(true))
    fireEvent.keyDown(document.body, { key: 'Escape' })
    clock.mockReturnValue(1100)
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(result.current.treeOpen).toBe(true)
  })
})
