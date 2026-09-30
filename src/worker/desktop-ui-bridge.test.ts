import { expect, it, vi } from 'vitest'
import type { EventBus } from '@earendil-works/pi-coding-agent'
import { createDesktopUIBridge } from './desktop-ui-bridge'

it('should_reject_unknown_custom_tui_when_no_interaction_protocol_is_declared', async () => {
  const emit = vi.fn()
  const bus = { on: () => () => {} } as unknown as EventBus
  const bridge = createDesktopUIBridge(bus, emit)
  const custom = bridge.uiContext.custom as (factory: unknown) => Promise<unknown>
  const pending = custom(() => ({}))
  const result = await Promise.race([pending.then(() => 'resolved', (error: Error) => error.message), new Promise<string>((resolve) => setTimeout(() => resolve('pending'), 10))])
  bridge.dispose()
  expect(result).toBe('UNSUPPORTED_DESKTOP_UI: custom TUI requires an adapter interaction protocol')
  expect(emit).not.toHaveBeenCalled()
})
