// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  PROVIDER_PRESETS,
  clonePresetConfig,
  isBuiltInSdkProviderId,
  validateProviderKey,
} from './model-provider-presets'
import { ModelsProviderCard } from './models-provider-card'
import { ProviderAddDialog } from './provider-add-dialog'

vi.mock('@renderer/lib/ipc-client', () => ({
  ipcClient: { invoke: vi.fn(async () => ({})) },
}))

afterEach(() => {
  cleanup()
})

describe('Zero-pollution model channel presets, creation & rename', () => {
  it('never injects starterModels or fake URLs/keys when cloning presets', () => {
    for (const preset of PROVIDER_PRESETS) {
      const cloned = clonePresetConfig(preset)
      expect(cloned.models).toEqual([])
      expect(cloned.name).toBeUndefined()
      expect(cloned.baseUrl).not.toBe('https://your-proxy.example.com/v1')
      expect(cloned.apiKey).not.toBe('$MY_API_KEY')
    }
  })

  it('validates custom provider IDs and detects built-in Pi SDK provider collisions', () => {
    expect(validateProviderKey('cpa', { other: {} })).toEqual({ ok: true, key: 'cpa' })
    expect(validateProviderKey('cpa', { cpa: {} })).toEqual({ ok: false, reason: 'duplicate' })
    expect(validateProviderKey('bad key!', {})).toEqual({ ok: false, reason: 'invalid-chars' })

    expect(isBuiltInSdkProviderId('openai')).toBe(true)
    expect(isBuiltInSdkProviderId('openrouter')).toBe(true)
    expect(isBuiltInSdkProviderId('cpa')).toBe(false)
    expect(isBuiltInSdkProviderId('openai-custom')).toBe(false)
  })

  it('creates a clean custom channel with user-chosen ID and 0 default models, and warns on built-in collision', () => {
    const onConfirm = vi.fn()
    render(
      <ProviderAddDialog
        open
        existingProviders={{ cpa: { baseUrl: 'https://cpa.example/v1' } }}
        runtimeSdkProviderIds={['openai', 'anthropic']}
        onConfirm={onConfirm}
        onClose={vi.fn()}
      />,
    )

    const keyInput = screen.getByTestId('new-provider-key-input')
    const urlInput = screen.getByTestId('new-provider-baseurl-input')

    // Typing 'openai' triggers SDK built-in collision warning & 1-click isolate button
    fireEvent.change(keyInput, { target: { value: 'openai' } })
    fireEvent.change(urlInput, { target: { value: 'https://my-relay.example/v1' } })
    const isolateBtn = screen.getByRole('button', { name: /openai-custom/i })
    expect(isolateBtn).toBeInTheDocument()

    // Clicking isolate switches ID to 'openai-custom'
    fireEvent.click(isolateBtn)
    expect((keyInput as HTMLInputElement).value).toBe('openai-custom')

    // User can also type their own exact ID like 'newapi'
    fireEvent.change(keyInput, { target: { value: 'newapi' } })
    fireEvent.click(screen.getByTestId('confirm-add-provider-btn'))

    expect(onConfirm).toHaveBeenCalledWith('newapi', {
      api: 'openai-responses',
      baseUrl: 'https://my-relay.example/v1',
      models: [],
    })
  })

  it('displays clean provider ID (never "自定义中转") when name is blank, and renames provider ID in-place', () => {
    const onRename = vi.fn(() => true)
    const onUpdate = vi.fn()
    render(
      <ModelsProviderCard
        pid="my-proxy"
        cardIndex={0}
        config={{
          providers: {
            'my-proxy': {
              baseUrl: 'https://relay.example/v1',
              api: 'openai-completions',
              models: [],
            },
          },
        }}
        open
        isBuiltInCollision={false}
        onToggleOpen={vi.fn()}
        fetching={false}
        remoteIds={[]}
        apiKeyVisible={false}
        onToggleApiKeyVisible={vi.fn()}
        expandedLocalModel={{}}
        onToggleLocalModel={vi.fn()}
        onApplyPreset={vi.fn()}
        onUpdateProvider={onUpdate}
        onRenameProvider={onRename}
        onFetchRemote={vi.fn()}
        onManualAdd={vi.fn()}
        onRemoveProvider={vi.fn()}
        onAddModel={vi.fn()}
        onAddAllNew={vi.fn()}
        onUpdateModel={vi.fn()}
        onRemoveModel={vi.fn()}
      />,
    )

    // Header shows 'my-proxy' cleanly without forced "Custom relay / 自定义中转"
    expect(screen.queryByText('自定义中转')).not.toBeInTheDocument()

    // Rename 'my-proxy' -> 'cpa-2' via in-place Provider ID input
    const keyField = screen.getByTestId('provider-key-input-my-proxy')
    fireEvent.change(keyField, { target: { value: 'cpa-2' } })
    fireEvent.blur(keyField)
    expect(onRename).toHaveBeenCalledWith('cpa-2')
  })
})
