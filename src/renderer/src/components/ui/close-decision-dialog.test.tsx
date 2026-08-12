import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import '@renderer/lib/i18n'
import { CloseDecisionDialog } from './close-decision-dialog'

const mocks = vi.hoisted(() => ({
  onCloseRequested: vi.fn(),
  invoke: vi.fn(),
}))

vi.mock('@renderer/lib/ipc-client', () => ({
  onCloseRequested: mocks.onCloseRequested,
  ipcClient: { invoke: mocks.invoke },
}))

describe('CloseDecisionDialog', () => {
  beforeEach(() => {
    mocks.onCloseRequested.mockReset()
    mocks.invoke.mockReset()
    mocks.invoke.mockResolvedValue({ ok: true })
    mocks.onCloseRequested.mockImplementation((cb: (info: { isStreaming: boolean }) => void) => {
      ;(mocks.onCloseRequested as unknown as { cb?: (info: { isStreaming: boolean }) => void }).cb = cb
      return () => undefined
    })
  })

  function emitCloseRequested() {
    const cb = (mocks.onCloseRequested as unknown as { cb?: (info: { isStreaming: boolean }) => void }).cb
    act(() => {
      cb?.({ isStreaming: true })
    })
  }

  it('renders nothing until the main process asks', () => {
    render(<CloseDecisionDialog />)
    expect(screen.queryByText(/A conversation is still running/i)).toBeNull()
  })

  it('shows the two options and cancel when close is requested while running', () => {
    render(<CloseDecisionDialog />)
    emitCloseRequested()
    expect(screen.getByText('Wait for it to finish, then close')).toBeTruthy()
    expect(screen.getByText('Close now')).toBeTruthy()
    expect(screen.getByText('Cancel')).toBeTruthy()
  })

  it('wait decision invokes close-decision with action wait and shows waiting state', () => {
    render(<CloseDecisionDialog />)
    emitCloseRequested()
    fireEvent.click(screen.getByText('Wait for it to finish, then close'))
    expect(mocks.invoke).toHaveBeenCalledWith('window:close-decision', { action: 'wait' })
    expect(screen.getByText('Waiting for the conversation to finish…')).toBeTruthy()
  })

  it('close now invokes close-decision with action now and dismisses', () => {
    render(<CloseDecisionDialog />)
    emitCloseRequested()
    fireEvent.click(screen.getByText('Close now'))
    expect(mocks.invoke).toHaveBeenCalledWith('window:close-decision', { action: 'now' })
    expect(screen.queryByText(/A conversation is still running/i)).toBeNull()
  })

  it('cancel invokes close-decision with action cancel and dismisses', () => {
    render(<CloseDecisionDialog />)
    emitCloseRequested()
    fireEvent.click(screen.getByText('Cancel'))
    expect(mocks.invoke).toHaveBeenCalledWith('window:close-decision', { action: 'cancel' })
    expect(screen.queryByText(/A conversation is still running/i)).toBeNull()
  })

  it('cancel waiting sends action cancel back', () => {
    render(<CloseDecisionDialog />)
    emitCloseRequested()
    fireEvent.click(screen.getByText('Wait for it to finish, then close'))
    fireEvent.click(screen.getByText('Cancel waiting'))
    expect(mocks.invoke).toHaveBeenLastCalledWith('window:close-decision', { action: 'cancel' })
  })
})
