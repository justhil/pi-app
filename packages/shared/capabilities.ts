/** Opt-in session capabilities (composer Tools menu). Off by default for every new session. */
export const CAPABILITY_IDS = ['pi-ui', 'browser'] as const
export type CapabilityId = (typeof CAPABILITY_IDS)[number]

export interface CapabilityInfo {
  id: CapabilityId
  /** False when it cannot be used right now (shown disabled in the menu). */
  available: boolean
  /** Why it is unavailable, e.g. 'browser-panel-off'. */
  reason?: string
  /** Rough size of the text added to the system prompt while on (chars / 4). */
  promptTokens: number
  /** Extra tools the model gets while on. */
  tools: number
}

export function normalizeCapabilities(raw: unknown): CapabilityId[] {
  if (!Array.isArray(raw)) return []
  const out: CapabilityId[] = []
  for (const id of raw) {
    if ((CAPABILITY_IDS as readonly unknown[]).includes(id) && !out.includes(id as CapabilityId)) out.push(id as CapabilityId)
  }
  return out
}
