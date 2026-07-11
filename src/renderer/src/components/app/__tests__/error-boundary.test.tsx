import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ErrorBoundary } from '../error-boundary'

function ThrowOnRender({ shouldThrow }: { shouldThrow: boolean }): React.ReactNode {
  if (shouldThrow) throw new Error('test error')
  return <div>content</div>
}

describe('ErrorBoundary', () => {
  it('renders children when no error', () => {
    render(
      <ErrorBoundary>
        <div>content</div>
      </ErrorBoundary>,
    )
    expect(screen.getByText('content')).toBeInTheDocument()
  })

  it('renders fallback on error with retry', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    render(
      <ErrorBoundary>
        <ThrowOnRender shouldThrow />
      </ErrorBoundary>,
    )
    expect(screen.getByText(/test error/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /retry|重试/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /reload|重新加载/i })).toBeInTheDocument()
    spy.mockRestore()
  })

  it('resets state when Retry is clicked', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const user = userEvent.setup()
    let shouldThrow = true
    const { rerender } = render(
      <ErrorBoundary>
        <ThrowOnRender shouldThrow={shouldThrow} />
      </ErrorBoundary>,
    )
    expect(screen.getByRole('button', { name: /retry|重试/i })).toBeInTheDocument()
    // Fix the child before retry so remount succeeds
    shouldThrow = false
    rerender(
      <ErrorBoundary>
        <ThrowOnRender shouldThrow={shouldThrow} />
      </ErrorBoundary>,
    )
    await user.click(screen.getByRole('button', { name: /retry|重试/i }))
    expect(screen.getByText('content')).toBeInTheDocument()
    spy.mockRestore()
  })
})
