// Native Renderers - desktop rendering for Trellis, Ask, Image extensions

import type { AppEvent } from '@shared/app-events'

// ── Trellis Subagent Progress Card ──
export interface TrellisSubagentProgress {
  runId: string
  status: 'running' | 'completed' | 'failed' | 'timedOut'
  agent: string
  model?: string
  thinking?: string
  toolTraces: { toolName: string; status: string; text?: string }[]
  usage?: { input: number; output: number; cost: number }
  error?: string
  textTail?: string
}

export function parseTrellisSubagentEvent(event: any): TrellisSubagentProgress | null {
  if (!event) return null
  // The trellis_subagent tool result contains progress data
  if (event.toolName === 'trellis_subagent' && event.result) {
    const r = event.result
    return {
      runId: r.runId || '',
      status: r.status || 'completed',
      agent: r.agent || 'unknown',
      model: r.model,
      thinking: r.thinking,
      toolTraces: r.toolTraces || [],
      usage: r.usage,
      error: r.error,
      textTail: r.textTail,
    }
  }
  return null
}

// ── Ask User Question Dialog ──
export interface AskQuestion {
  questions: {
    question: string
    header?: string
    options: { label: string; description?: string; preview?: string }[]
    multiSelect?: boolean
  }[]
}

export function parseAskQuestionEvent(event: any): AskQuestion | null {
  if (!event) return null
  if (event.toolName === 'ask_user_question' && event.args) {
    return { questions: event.args.questions || [] }
  }
  return null
}

// ── Image Generation/Review ──
export interface ImageGenResult {
  images: { url?: string; path?: string; name?: string }[]
  prompt: string
}

export function parseImageGenEvent(event: any): ImageGenResult | null {
  if (!event) return null
  if ((event.toolName === 'image_gen' || event.toolName === 'image_review') && event.result) {
    return {
      images: event.result.images || [],
      prompt: event.result.prompt || '',
    }
  }
  return null
}
