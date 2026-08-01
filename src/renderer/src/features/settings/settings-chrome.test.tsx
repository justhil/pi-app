import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { TopBar } from '@renderer/components/app/top-bar'
import { SettingsNav } from './settings-shell'

describe('settings chrome', () => {
  it('shows one visible Settings title without the main-shell status dot', () => {
    const { container } = render(
      <>
        <TopBar title="Settings" onBack={vi.fn()} />
        <SettingsNav title="Settings">
          <button type="button">General</button>
        </SettingsNav>
      </>,
    )

    expect(screen.getAllByText('Settings')).toHaveLength(1)
    expect(screen.getByRole('navigation', { name: 'Settings' })).toBeInTheDocument()
    expect(container.querySelector('svg.text-primary')).toBeNull()
  })
})
