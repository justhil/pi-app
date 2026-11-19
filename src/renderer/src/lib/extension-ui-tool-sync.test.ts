// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useUIStore } from '@renderer/stores/ui-store'
import { useExtensionUIStore } from '@renderer/stores/extension-ui-store'
import {
  interactiveToolsForDialogMethod,
  isInteractiveExtensionTool,
  linkExtensionDialogToToolRow,
} from './extension-ui-tool-sync'

const catalogAdapters = vi.hoisted(() => ({ current: [] as unknown[] }))

vi.mock('@renderer/lib/adapter-catalog', () => ({
  currentAdapterCatalog: () => catalogAdapters.current,
}))

describe('extension-ui-tool-sync dynamic adapter interact tools', () => {
  beforeEach(() => {
    catalogAdapters.current = [
      {
        id: 'custom-survey',
        tier: 'partial',
        interact: {
          trigger: { tool: 'goal_questionnaire' },
          schema: 'questions',
        },
      },
      {
        id: 'custom-audit',
        tier: 'partial',
        interact: {
          trigger: { tool: 'artifact_review' },
          schema: 'review',
        },
      },
    ]
    useExtensionUIStore.setState({ activePending: null, suspended: null })
    useUIStore.setState({
      timelineItems: [
        {
          id: 'row-1',
          type: 'tool-call',
          toolCallId: 'call-99',
          toolName: 'goal_questionnaire',
          toolPhase: 'start',
          timestamp: Date.now(),
        },
      ],
    })
  })

  it('recognizes adapter-declared interact.trigger.tool names dynamically without hardcoding', () => {
    expect(isInteractiveExtensionTool('goal_questionnaire')).toBe(true)
    expect(isInteractiveExtensionTool('artifact_review')).toBe(true)
    expect(isInteractiveExtensionTool('bash')).toBe(false)
    expect(interactiveToolsForDialogMethod('questions')).toEqual(new Set())
    expect(interactiveToolsForDialogMethod('ask_user_question').has('goal_questionnaire')).toBe(true)
    expect(interactiveToolsForDialogMethod('image_review').has('artifact_review')).toBe(true)
  })

  it('links dialog requests to custom adapter interactive tool rows', () => {
    linkExtensionDialogToToolRow('req-42', 'ask_user_question')
    const row = useUIStore.getState().timelineItems[0]
    expect(row.extensionUiRequestId).toBe('req-42')
    expect(row.extensionUiSuspended).toBe(false)
  })
})
