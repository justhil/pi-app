import { act, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { useUIStore } from '@renderer/stores/ui-store'
import { ConversationContextHeader } from './conversation-context-header'

beforeEach(() => useUIStore.setState({ sidebarStyle: 'compact' }))

describe('conversation workspace context', () => {
  it('shows the active checkout and branch in compact mode with full paths available on hover', () => {
    render(<ConversationContextHeader workspacePath={'C:\\projects\\feature-checkout\\'} branch="refs/heads/feat/sidebar" />)
    const header = screen.getByRole('group', { name: 'Current conversation workspace and branch' })
    expect(header).toHaveTextContent('Workspace: feature-checkout')
    expect(header).toHaveTextContent('Branch: feat/sidebar')
    expect(screen.getByTitle('C:\\projects\\feature-checkout\\')).toContainElement(header.querySelector('.truncate'))
    expect(screen.getByTitle('refs/heads/feat/sidebar')).toBeInTheDocument()
  })

  it('follows style changes without leaving duplicate metadata in full mode', () => {
    render(<ConversationContextHeader workspacePath="/repo" branch="main" />)
    expect(screen.getByRole('group')).toBeInTheDocument()
    act(() => useUIStore.setState({ sidebarStyle: 'full' }))
    expect(screen.queryByRole('group')).toBeNull()
    act(() => useUIStore.setState({ sidebarStyle: 'compact' }))
    expect(screen.getByRole('group')).toHaveTextContent('main')
  })

  it('updates the checkout and drops the previous branch while the next workspace loads', () => {
    const { rerender } = render(<ConversationContextHeader workspacePath="/repo/main-checkout" branch="main" />)
    rerender(<ConversationContextHeader workspacePath="/worktrees/feature" />)
    expect(screen.getByRole('group')).toHaveTextContent('Workspace: feature')
    expect(screen.queryByText('Branch: main')).toBeNull()
    expect(screen.queryByTitle('main')).toBeNull()
    rerender(<ConversationContextHeader workspacePath="/worktrees/feature" branch="feat/new" />)
    expect(screen.getByRole('group')).toHaveTextContent('Branch: feat/new')
  })

  it('shows only the directory for a non-Git project and hides context for temporary chats', () => {
    const { rerender } = render(<ConversationContextHeader workspacePath="/projects/notes" />)
    expect(screen.getByRole('group')).toHaveTextContent('Workspace: notes')
    expect(screen.queryByText('Branch:')).toBeNull()
    rerender(<ConversationContextHeader workspacePath="/app/sandbox-workspaces/chat" branch="main" />)
    expect(screen.queryByRole('group')).toBeNull()
    rerender(<ConversationContextHeader workspacePath={null} branch="main" />)
    expect(screen.queryByRole('group')).toBeNull()
  })
})
