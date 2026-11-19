import { describe, expect, it } from 'vitest'
import {
  DEFAULT_PURGE_STRATEGY,
  PURGE_THINKING_GUIDANCES,
  strategyForPreset,
} from '@shared/agent-purge'
import { promptTextSchema, purgeStrategyPatchSchema } from './schemas'

describe('purge IPC Zod schema alignment', () => {
  it('accepts every field of DEFAULT_PURGE_STRATEGY and all preset strategies in promptTextSchema and purgeStrategyPatchSchema', () => {
    const presets = [
      DEFAULT_PURGE_STRATEGY,
      strategyForPreset('standard'),
      strategyForPreset('relay_push'),
      strategyForPreset('tunnel'),
    ]

    for (const strategy of presets) {
      expect(purgeStrategyPatchSchema.safeParse(strategy).success).toBe(true)
      expect(
        promptTextSchema.safeParse({
          text: 'hello',
          sessionFile: '/tmp/proj/s1.jsonl',
          agentPurge: {
            enabled: true,
            personaId: 'konata',
            mode: 'replace',
            strategy,
          },
        }).success,
      ).toBe(true)
    }

    for (const thinkingGuidance of PURGE_THINKING_GUIDANCES) {
      expect(purgeStrategyPatchSchema.safeParse({ thinkingGuidance }).success).toBe(true)
    }
  })
})
