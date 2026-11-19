import { describe, expect, it } from 'vitest'
import {
  buildModelEntryFromUpstream,
  compactModelsDevResponse,
  computeSpecFillPatch,
  normalizeCatalogModelId,
  resolveUpstreamModelSpec,
  searchModelSuggestions,
} from './models-dev-catalog'

const SAMPLE_MODELS_DEV = {
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
  zhipuai: {
    id: 'zhipuai',
    name: 'Zhipu AI',
    api: 'https://open.bigmodel.cn/api/paas/v4',
    models: {
      'glm-5': {
        id: 'glm-5',
        name: 'GLM-5',
        release_date: '2026-04-01',
        reasoning: true,
        modalities: { input: ['text'], output: ['text'] },
        limit: { context: 128000, output: 16384 },
        cost: { input: 1.0, output: 3.2, cache_read: 0.2 },
      },
      'whisper-audio': {
        id: 'whisper-audio',
        type: 'transcription',
        name: 'Whisper',
        modalities: { input: ['audio'], output: ['text'] },
      },
    },
  },
  openrouter: {
    id: 'openrouter',
    name: 'OpenRouter',
    api: 'https://openrouter.ai/api/v1',
    models: {
      'zhipuai/glm-5:free': {
        id: 'zhipuai/glm-5:free',
        name: 'GLM-5 (Free)',
        canonical_model_id: 'zhipuai/glm-5',
        reasoning: true,
        modalities: { input: ['text'], output: ['text'] },
        limit: { context: 128000, output: 16384 },
        cost: { input: 0, output: 0 },
      },
    },
  },
}

describe('models-dev-catalog', () => {
  it('normalizes vendor prefixes, variant suffixes, context tags, and @ markers', () => {
    expect(normalizeCatalogModelId('anthropic/claude-sonnet-4-5:thinking')).toBe('claude-sonnet-4-5')
    expect(normalizeCatalogModelId('vertex/claude-opus-4@20250514[1m]')).toBe('claude-opus-4-20250514')
    expect(normalizeCatalogModelId('  ZhipuAI/GLM-5  ')).toBe('glm-5')
  })

  it('compacts models.dev response filtering out non-chat models and preserving metadata', () => {
    const snap = compactModelsDevResponse(SAMPLE_MODELS_DEV, { updatedAt: 1000 })
    expect(snap.providerCount).toBe(3)
    expect(snap.models.some((m) => m.id === 'whisper-audio')).toBe(false)

    const sonnet = resolveUpstreamModelSpec(snap, 'claude-sonnet-4-5-20250929', {
      baseUrl: 'https://api.anthropic.com',
    })
    expect(sonnet).toMatchObject({
      id: 'claude-sonnet-4-5',
      contextWindow: 200000,
      maxTokens: 64000,
      reasoning: true,
      input: ['text', 'image'],
      cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
    })

    // Relay/prefixed ID resolves via canonical/normalized lookup
    const relayGlm = resolveUpstreamModelSpec(snap, 'custom-relay/glm-5:fast', {
      baseUrl: 'https://my-relay.example/v1',
    })
    expect(relayGlm?.contextWindow).toBe(128000)
    expect(relayGlm?.maxTokens).toBe(16384)
  })

  it('builds complete Pi models.json entry and non-destructively fills existing entries', () => {
    const snap = compactModelsDevResponse(SAMPLE_MODELS_DEV, { updatedAt: 1000 })
    const spec = resolveUpstreamModelSpec(snap, 'claude-sonnet-4-5')!
    const built = buildModelEntryFromUpstream('my-proxy/claude-sonnet-4-5', spec)
    expect(built).toMatchObject({
      id: 'my-proxy/claude-sonnet-4-5',
      name: 'Claude Sonnet 4.5',
      contextWindow: 200000,
      maxTokens: 64000,
      reasoning: true,
      input: ['text', 'image'],
      thinkingLevelMap: { low: 'low', medium: 'medium', high: 'high' },
    })

    // Existing entry with custom contextWindow preserves user override when overwriteExisting is false
    const patch = computeSpecFillPatch(
      { id: 'claude-sonnet-4-5', name: 'claude-sonnet-4-5', contextWindow: 64000 },
      spec,
    )
    expect(patch.contextWindow).toBeUndefined()
    expect(patch.maxTokens).toBe(64000)
    expect(patch.name).toBe('Claude Sonnet 4.5')
    expect(patch.cost?.input).toBe(3)
  })

  it('ranks remote /v1/models enriched with models.dev ahead of general catalog matches', () => {
    const snap = compactModelsDevResponse(SAMPLE_MODELS_DEV, { updatedAt: 1000 })
    const suggestions = searchModelSuggestions('sonnet', {
      catalog: snap,
      remoteIds: ['my-relay/claude-sonnet-4-5'],
      providerId: 'anthropic',
      baseUrl: 'https://api.anthropic.com',
    })
    expect(suggestions[0]).toMatchObject({
      id: 'my-relay/claude-sonnet-4-5',
      source: 'remote',
      contextWindow: 200000,
      reasoning: true,
    })
  })
})
