import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { SettingsSearchContext, SettingsSection, SettingRow } from './settings-page-shared'

describe('Settings search presentation', () => {
  it('filters by the row label or description and keeps controls labelled', () => {
    render(<SettingsSearchContext.Provider value="sound"><SettingsSection title="Notifications"><SettingRow label="Sound" description="Play a tone"><input /></SettingRow><SettingRow label="Language"><select /></SettingRow></SettingsSection></SettingsSearchContext.Provider>)
    expect(screen.getByRole('group', { name: 'Sound' })).toBeInTheDocument()
    expect(screen.queryByText('Language')).not.toBeInTheDocument()
  })

  it('should_keep_a_row_when_search_matches_an_option', () => {
    render(<SettingsSearchContext.Provider value="phosphor"><SettingsSection title="Icons"><SettingRow label="Icon style"><button>Phosphor</button><button>Lucide</button></SettingRow></SettingsSection></SettingsSearchContext.Provider>)
    expect(screen.getByRole('button', { name: 'Phosphor' })).toBeInTheDocument()
  })

  it('keeps every row when a section title matches', () => {
    render(<SettingsSearchContext.Provider value="notifications"><SettingsSection title="Notifications"><SettingRow label="Sound"><input /></SettingRow><SettingRow label="Delivery"><select /></SettingRow></SettingsSection></SettingsSearchContext.Provider>)
    expect(screen.getByText('Sound')).toBeInTheDocument()
    expect(screen.getByText('Delivery')).toBeInTheDocument()
  })
})
