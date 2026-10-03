import { CAPABILITY_IDS, normalizeCapabilities, type CapabilityId, type CapabilityInfo } from '@shared/capabilities'
import piUiPrompt from './pi-ui.md?raw'

/** Prompt text appended to the system prompt while a capability is on (strip the source comment). */
const PROMPTS: Partial<Record<CapabilityId, string>> = {
  'pi-ui': piUiPrompt.replace(/^<!--[\s\S]*?-->\s*/, '').trim(),
}

/** Browser control lands with the browser_* tools; until then it is listed but unavailable. */
const AVAILABLE: Record<CapabilityId, boolean> = { 'pi-ui': true, browser: false }

export function capabilityCatalog(): CapabilityInfo[] {
  return CAPABILITY_IDS.map((id) => ({
    id,
    available: AVAILABLE[id],
    promptTokens: Math.round((PROMPTS[id]?.length ?? 0) / 4),
    tools: 0,
  }))
}

/** Prompt sections for the enabled, available capabilities, in catalog order. */
export function capabilitySections(raw: unknown): string[] {
  const enabled = normalizeCapabilities(raw)
  return CAPABILITY_IDS.filter((id) => enabled.includes(id) && AVAILABLE[id] && PROMPTS[id]).map((id) => PROMPTS[id]!)
}
