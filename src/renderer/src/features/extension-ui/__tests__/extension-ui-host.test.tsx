import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import i18n from '@renderer/lib/i18n'
import { useExtensionUIStore } from '@renderer/stores/extension-ui-store'
import { ExtensionUIHost } from '../extension-ui-host'

const invoke = vi.fn(async (..._args: unknown[]) => ({}))
vi.mock('@renderer/lib/ipc-client', () => ({ ipcClient: { invoke: (...args: unknown[]) => invoke(...args) } }))

beforeAll(async () => {
  await i18n.changeLanguage('en')
})
afterEach(() => {
  act(() => useExtensionUIStore.setState({ activePending: null, suspended: null }))
  invoke.mockClear()
})

const responses = () => invoke.mock.calls.filter((call) => call[0] === 'extension.respondUI').map((call) => call[1])

describe('ExtensionUIHost', () => {
  it('starts every input request empty, focused, and submits on Enter', () => {
    render(<ExtensionUIHost />)
    act(() => useExtensionUIStore.setState({ activePending: { id: 'a', method: 'input', title: 'Name?' } }))
    const first = screen.getByRole('textbox')
    expect(first).toHaveFocus()
    fireEvent.change(first, { target: { value: 'draft' } })

    act(() => useExtensionUIStore.setState({ activePending: { id: 'b', method: 'input', title: 'Branch?' } }))
    const second = screen.getByRole('textbox')
    expect(second).toHaveValue('')
    fireEvent.change(second, { target: { value: 'main' } })
    fireEvent.submit(second.closest('form')!)
    expect(responses()).toEqual([{ id: 'b', value: 'main' }])
  })

  it('picks a select option with its number key', () => {
    render(<ExtensionUIHost />)
    act(() => useExtensionUIStore.setState({ activePending: { id: 's', method: 'select', title: 'Mode', options: ['fast', 'safe', 'off'] } }))
    expect(screen.getByRole('option', { name: /fast/ })).toHaveFocus()
    fireEvent.keyDown(screen.getByRole('listbox'), { key: '2' })
    expect(responses()).toEqual([{ id: 's', value: 'safe' }])
  })

  it('focuses Yes in a confirm dialog and keeps the message readable', () => {
    render(<ExtensionUIHost />)
    act(() => useExtensionUIStore.setState({ activePending: { id: 'c', method: 'confirm', title: 'Delete?', message: 'Remove 3 files' } }))
    expect(screen.getByRole('button', { name: 'Yes' })).toHaveFocus()
    expect(screen.getByRole('dialog', { name: 'Delete?' })).toHaveTextContent('Remove 3 files')
    fireEvent.click(screen.getByRole('button', { name: 'No' }))
    expect(responses()).toEqual([{ id: 'c', confirmed: false }])
  })
})
