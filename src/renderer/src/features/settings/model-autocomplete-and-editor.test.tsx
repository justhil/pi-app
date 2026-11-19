// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { compactModelsDevResponse } from '@shared/models-dev-catalog'
import { useUpstreamModelCatalogStore } from './upstream-model-catalog'
import { ModelsProviderCard } from './models-provider-card'
import { ModelEntryEditor } from './model-entry-editor'
import type { PiModelsConfigPayload } from '@shared/ipc-contract'

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-i18next')>()
  return {
    ...actual,
    useTranslation: () => ({ t: (k: string, opts?: Record<string, unknown>) => (opts?.name ? `${k}:${opts.name}` : k) }),
  }
})

vi.mock('@renderer/lib/ipc-client', () => ({
  ipcClient: { invoke: vi.fn().mockResolvedValue(null) },
}))

const SNAP = compactModelsDevResponse({
  anthropic: {
    id: 'anthropic',
    name: 'Anthropic',
    api: 'https://api.anthropic.com',
    models: {
      'claude-sonnet-4-5': {
        id: 'claude-sonnet-4-5',
        name: 'Claude Sonnet 4.5',
        release_date: '2025-09-29',
        reasoning: true,
        reasoning_options: [{ type: 'effort', values: ['low', 'medium', 'high'] }],
        modalities: { input: ['text', 'image'], output: ['text'] },
        limit: { context: 200000, output: 64000 },
        cost: { input: 3, output: 15, cache_read: 0.3, cache_write: 3.75 },
      },
    },
  },
})

describe('Model autocomplete & two-tier entry editor', () => {
  beforeEach(() => {
    useUpstreamModelCatalogStore.setState({
      snapshot: SNAP,
      loading: false,
      error: null,
      attempted: true,
    })
  })

  afterEach(() => {
    cleanup()
  })

  it('shows live models.dev suggestions with specs and fills missing specs on existing models', () => {
    const onAddModel = vi.fn()
    const onUpdateModel = vi.fn()
    const config: PiModelsConfigPayload = {
      providers: {
        relay: {
          name: 'My Relay',
          baseUrl: 'https://relay.example/v1',
          api: 'anthropic-messages',
          models: [{ id: 'claude-sonnet-4-5' }],
        },
      },
    }

    render(
      <ModelsProviderCard
        pid="relay"
        cardIndex={0}
        config={config}
        open
        onToggleOpen={vi.fn()}
        fetching={false}
        remoteIds={['proxy/claude-sonnet-4-5']}
        apiKeyVisible={false}
        onToggleApiKeyVisible={vi.fn()}
        expandedLocalModel={{}}
        onToggleLocalModel={vi.fn()}
        onApplyPreset={vi.fn()}
        onUpdateProvider={vi.fn()}
        onFetchRemote={vi.fn()}
        onManualAdd={vi.fn()}
        onRemoveProvider={vi.fn()}
        onAddModel={onAddModel}
        onAddAllNew={vi.fn()}
        onUpdateModel={onUpdateModel}
        onRemoveModel={vi.fn()}
      />,
    )

    // Autocomplete search shows enriched remote suggestion and clicking adds it
    const input = screen.getByTestId('model-autocomplete-input-relay')
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: 'sonnet' } })
    const list = screen.getByTestId('model-autocomplete-list-relay')
    expect(list).toHaveTextContent('proxy/claude-sonnet-4-5')
    expect(list).toHaveTextContent('200K')

    fireEvent.click(within(list).getByText('proxy/claude-sonnet-4-5'))
    expect(onAddModel).toHaveBeenCalledWith('proxy/claude-sonnet-4-5')

    // One-click fill missing specs populates context/output/pricing for bare existing entry
    fireEvent.click(screen.getByTestId('fill-missing-specs-relay'))
    expect(onUpdateModel).toHaveBeenCalledWith(
      'claude-sonnet-4-5',
      expect.objectContaining({
        name: 'Claude Sonnet 4.5',
        contextWindow: 200000,
        maxTokens: 64000,
        reasoning: true,
        cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
      }),
    )
  })

  it('keeps core fields concise while preserving all advanced settings inside collapsible drawer', () => {
    render(
      <ModelEntryEditor
        model={{
          id: 'claude-sonnet-4-5',
          name: 'Claude Sonnet 4.5',
          reasoning: true,
          contextWindow: 200000,
          maxTokens: 64000,
          input: ['text', 'image'],
          cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
        }}
        expanded
        matchedSpec={SNAP.models[0]}
        onToggleExpand={vi.fn()}
        onChange={vi.fn()}
        onApplySpec={vi.fn()}
        onRemove={vi.fn()}
      />,
    )

    // Core fields visible right away
    expect(screen.getByLabelText('contextWindow')).toBeInTheDocument()
    expect(screen.getByLabelText('maxTokens')).toBeInTheDocument()

    // Advanced fields folded by default
    expect(screen.queryByLabelText('cost.input')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('samplingParams.temperature')).not.toBeInTheDocument()

    // Expanding advanced drawer reveals pricing, cache, thinking map, sampling & compat untouched
    fireEvent.click(screen.getByTestId('model-advanced-toggle-claude-sonnet-4-5'))
    expect(screen.getByLabelText('cost.input')).toBeInTheDocument()
    expect(screen.getByLabelText('promptCache.short')).toBeInTheDocument()
    expect(screen.getByLabelText('samplingParams.temperature')).toBeInTheDocument()
    expect(screen.getByLabelText('compat.supportsDeveloperRole')).toBeInTheDocument()
  })
})
