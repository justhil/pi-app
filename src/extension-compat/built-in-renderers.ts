// Extension Compatibility Layer

import type { ExtensionProbeResult, CompatibilityLevel, RemoteAdapterEntry } from '@shared/extension-types'

const BUILTIN_REGISTRY: Record<string, RemoteAdapterEntry> = {
  trellis: {
    id: 'trellis',
    displayName: 'Trellis',
    compatibility: 'native',
    match: { tools: ['trellis_subagent'] },
    rendererMap: {
      'trellis-subagent-progress': 'trellis.subagentProgress',
      'trellis-task-status': 'trellis.taskStatus',
    },
    risk: { level: 'low', message: 'Trellis adapter only reads task state and renders subagent progress.' },
  },
  ask: {
    id: 'ask',
    displayName: 'Ask User Question',
    compatibility: 'native',
    match: { tools: ['ask_user_question'] },
    rendererMap: {
      'ask.choice': 'ask.choice',
      'ask.confirm': 'ask.confirm',
    },
    risk: { level: 'low', message: 'Ask adapter renders user interaction as desktop dialogs.' },
  },
  image: {
    id: 'image',
    displayName: 'Image Generation/Review',
    compatibility: 'native',
    match: { tools: ['image_gen', 'image_review'] },
    rendererMap: {
      'image.gen': 'image.gen',
      'image.review': 'image.review',
    },
    risk: { level: 'low', message: 'Image adapter renders generation results and review cards.' },
  },
}

export function evaluateCompatibility(
  probeResult: ExtensionProbeResult,
  registry: Record<string, RemoteAdapterEntry> = BUILTIN_REGISTRY,
): { level: CompatibilityLevel; adapterId?: string } {
  for (const [adapterId, entry] of Object.entries(registry)) {
    if (entry.match.tools?.some(t => probeResult.registeredTools.includes(t))) {
      return { level: entry.compatibility as CompatibilityLevel, adapterId }
    }
  }
  // No match found - check if it has any tools at all
  if (probeResult.registeredTools.length > 0 || probeResult.registeredCommands.length > 0) {
    return { level: 'blocked' }
  }
  return { level: 'blocked' }
}

export function getBuiltinRegistry(): Record<string, RemoteAdapterEntry> {
  return BUILTIN_REGISTRY
}

export function getRendererId(adapterId: string, kind: string): string | null {
  const entry = BUILTIN_REGISTRY[adapterId]
  if (!entry?.rendererMap) return null
  return entry.rendererMap[kind] || null
}
