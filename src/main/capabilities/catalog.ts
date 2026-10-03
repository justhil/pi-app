import { CAPABILITY_IDS, normalizeCapabilities, type CapabilityId, type CapabilityInfo } from '@shared/capabilities'
import { BROWSER_TOOL_NAMES } from '@shared/browser-tools'
import piUiPrompt from './pi-ui.md?raw'

const BROWSER_TOOL_COUNT = BROWSER_TOOL_NAMES.length

/** Prompt text appended to the system prompt while a capability is on (strip the source comment). */
const PROMPTS: Partial<Record<CapabilityId, string>> = {
  'pi-ui': piUiPrompt.replace(/^<!--[\s\S]*?-->\s*/, '').trim(),
  browser: [
    '# Built-in browser',
    'The user has given you the browser_* tools for this conversation. They drive the browser panel inside pi Desktop, which the user can watch and take over; tabs keep the user\'s sign-ins.',
    '- Read the page with browser_snapshot (or browser_find on big pages), then act with refs like e12. Action results list what changed on the page, so a new snapshot is rarely needed. Use browser_take_screenshot only for visual checks.',
    '- Stay on the task the user asked for. Before submitting forms, purchasing, posting, deleting or changing account settings, ask the user first.',
    '- If a page shows a CAPTCHA, a sign-in wall or a dialog you cannot pass, stop and ask the user to handle it in the browser panel.',
  ].join('\n'),
}

/** Tool families a capability switches on in the worker (active tool set). */
const TOOL_FAMILIES: Partial<Record<CapabilityId, string>> = { browser: 'browser' }

let browserPanelEnabled: () => boolean = () => false

/** Main wires the live settings in at startup (kept out of this module so it stays importable in tests). */
export function configureCapabilities(opts: { browserPanelEnabled: () => boolean }): void {
  browserPanelEnabled = opts.browserPanelEnabled
}

function available(id: CapabilityId): { ok: boolean; reason?: string } {
  if (id === 'browser' && !browserPanelEnabled()) return { ok: false, reason: 'browser-panel-off' }
  return { ok: true }
}

export function capabilityCatalog(): CapabilityInfo[] {
  return CAPABILITY_IDS.map((id) => {
    const a = available(id)
    return {
      id,
      available: a.ok,
      ...(a.reason ? { reason: a.reason } : {}),
      promptTokens: Math.round((PROMPTS[id]?.length ?? 0) / 4),
      tools: id === 'browser' ? BROWSER_TOOL_COUNT : 0,
    }
  })
}

const enabledAvailable = (raw: unknown) => {
  const enabled = normalizeCapabilities(raw)
  return CAPABILITY_IDS.filter((id) => enabled.includes(id) && available(id).ok)
}

/** Prompt sections for the enabled, available capabilities, in catalog order. */
export function capabilitySections(raw: unknown): string[] {
  return enabledAvailable(raw)
    .map((id) => PROMPTS[id])
    .filter((p): p is string => !!p)
}

/** Tool families to activate in the worker for the enabled, available capabilities. */
export function capabilityToolFamilies(raw: unknown): string[] {
  return enabledAvailable(raw)
    .map((id) => TOOL_FAMILIES[id])
    .filter((f): f is string => !!f)
}
