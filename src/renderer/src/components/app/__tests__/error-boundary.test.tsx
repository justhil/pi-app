import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ErrorBoundary } from '../error-boundary'

function ThrowOnRender(): never {
  throw new Error('test error')
}

describe('ErrorBoundary', () => {
  it('renders children when no error', () => {
    render(<ErrorBoundary><div>content</div></ErrorBoundary>)
    expect(screen.getByText('content')).toBeInTheDocument()
  })

  it('renders fallback on error', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    render(<ErrorBoundary><ThrowOnRender /></ErrorBoundary>)
    expect(screen.getByText(/渲染失败/)).toBeInTheDocument()
    spy.mockRestore()
  })
})
