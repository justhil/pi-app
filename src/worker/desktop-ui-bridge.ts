// Bridges pi ExtensionUIContext to Electron (RPC-style pending requests + ask_user_question custom UI)

import type { EventBus } from '@earendil-works/pi-coding-agent'
import { randomUUID } from 'node:crypto'

export const ASK_USER_PROMPT_EVENT = 'rpiv:ask-user:prompt'

export type ExtensionUIRequest =
  | { id: string; method: 'select'; title: string; options: string[]; timeout?: number }
  | { id: string; method: 'confirm'; title: string; message: string; timeout?: number }
  | { id: string; method: 'input'; title: string; placeholder?: string; timeout?: number }
  | { id: string; method: 'editor'; title: string; prefill?: string }
  | { id: string; method: 'notify'; message: string; notifyType?: 'info' | 'warning' | 'error' }
  | { id: string; method: 'custom'; kind: 'ask_user_question'; questions: unknown }
  | { id: string; method: 'custom'; kind: 'image_review'; image: string; title: string; question: string; context?: string; options: string[]; allowFeedback: boolean }

type Pending = {
  resolve: (v: unknown) => void
  reject: (e: Error) => void
  cleanup: () => void
}

export type DesktopUIBridge = {
  uiContext: Record<string, unknown>
  handleExtensionUIResponse: (response: ExtensionUIResponse) => void
  /** Cache interact args extracted by Worker (driven by adapter.json interact.fields). */
  setInteractArgs: (schema: 'questions' | 'review' | 'clarify', args: Record<string, unknown> | null) => void
  dispose: () => void
}

export type ExtensionUIResponse = {
  id: string
  value?: string
  confirmed?: boolean
  cancelled?: boolean
  result?: unknown
}

function createDialogPromise<T>(
  emit: (req: ExtensionUIRequest) => void,
  pending: Map<string, Pending>,
  request: ExtensionUIRequest,
  parse: (r: ExtensionUIResponse) => T,
  defaultValue: T,
  opts?: { signal?: AbortSignal; timeout?: number },
): Promise<T> {
  if (opts?.signal?.aborted) return Promise.resolve(defaultValue)

  const id = request.id
  return new Promise((resolve, reject) => {
    let timeoutId: ReturnType<typeof setTimeout> | undefined
    const cleanup = () => {
      if (timeoutId) clearTimeout(timeoutId)
      opts?.signal?.removeEventListener('abort', onAbort)
      pending.delete(id)
    }
    const onAbort = () => {
      cleanup()
      resolve(defaultValue)
    }
    opts?.signal?.addEventListener('abort', onAbort, { once: true })
    if (opts?.timeout) {
      timeoutId = setTimeout(() => {
        cleanup()
        resolve(defaultValue)
      }, opts.timeout)
    }
    pending.set(id, {
      resolve: (v) => resolve(parse(v as ExtensionUIResponse)),
      reject,
      cleanup,
    })
    emit(request)
  })
}

export function createDesktopUIBridge(
  eventBus: EventBus,
  onRequest: (req: ExtensionUIRequest) => void,
): DesktopUIBridge {
  const pending = new Map<string, Pending>()
  let lastAskPayload: { questions: unknown } | null = null
  /** Interact args cached by Worker from adapter.json interact.fields, keyed by schema type. */
  let interactArgs: { schema: string; args: Record<string, unknown> } | null = null

  const emitReq = (req: ExtensionUIRequest) => {
    onRequest(req)
  }

  const unsubAsk = eventBus.on(ASK_USER_PROMPT_EVENT, (payload: { questions: unknown }) => {
    lastAskPayload = payload
  })

  const buildAskQuestions = (): unknown[] => {
    // Prefer interact-cached questions (from tool args, has preview text) merged with event questions.
    const eventQs = (lastAskPayload?.questions as any[]) || []
    const interactQs = (interactArgs?.schema === 'questions' ? interactArgs.args.questions : null) as any[] | undefined
    const toolQs = interactQs || []
    if (toolQs.length === 0) return eventQs
    if (eventQs.length === 0) return toolQs
    return eventQs.map((eq: any, qi: number) => {
      const tq = toolQs[qi]
      if (!tq?.options) return eq
      const opts = (eq.options || []).map((eo: any, oi: number) => {
        const to = tq.options[oi]
        const preview = typeof to?.preview === 'string' ? to.preview : undefined
        return preview ? { ...eo, preview } : eo
      })
      return { ...eq, options: opts }
    })
  }

  const uiContext = {
    select: (title: string, options: string[], opts?: { signal?: AbortSignal; timeout?: number }) =>
      createDialogPromise(
        emitReq,
        pending,
        { id: randomUUID(), method: 'select', title, options, timeout: opts?.timeout },
        (r) => (r.cancelled ? undefined : r.value),
        undefined,
        opts,
      ),

    confirm: (title: string, message: string, opts?: { signal?: AbortSignal; timeout?: number }) =>
      createDialogPromise(
        emitReq,
        pending,
        { id: randomUUID(), method: 'confirm', title, message, timeout: opts?.timeout },
        (r) => (r.cancelled ? false : !!r.confirmed),
        false,
        opts,
      ),

    input: (title: string, placeholder?: string, opts?: { signal?: AbortSignal; timeout?: number }) =>
      createDialogPromise(
        emitReq,
        pending,
        { id: randomUUID(), method: 'input', title, placeholder, timeout: opts?.timeout },
        (r) => (r.cancelled ? undefined : r.value),
        undefined,
        opts,
      ),

    notify: (message: string, notifyType?: 'info' | 'warning' | 'error') => {
      emitReq({ id: randomUUID(), method: 'notify', message, notifyType })
    },

    onTerminalInput: () => () => {},

    setStatus: () => {},
    setWorkingMessage: () => {},
    setWorkingVisible: () => {},
    setWorkingIndicator: () => {},
    setHiddenThinkingLabel: () => {},
    setWidget: () => {},
    setFooter: () => {},
    setHeader: () => {},
    setTitle: () => {},

    async custom<T>(_factory: unknown, _options?: unknown): Promise<T> {
      const id = randomUUID()
      // Route by interact schema (cached by Worker from adapter.json interact.fields).
      if (interactArgs?.schema === 'review') {
        const a = interactArgs.args
        interactArgs = null
        const opts = (Array.isArray(a.options) && a.options.length > 0)
          ? a.options.slice(0, 4)
          : ['通过', '需要修改', '重做', '取消']
        const req: ExtensionUIRequest = {
          id, method: 'custom', kind: 'image_review',
          image: String(a.image || ''),
          title: String(a.title || '').trim() || '图片审查',
          question: String(a.question || '').trim() || '这张图片是否可用？',
          context: a.context ? String(a.context).trim() || undefined : undefined,
          options: opts as string[],
          allowFeedback: a.allow_feedback !== false,
        }
        return createDialogPromise(
          emitReq,
          pending,
          req,
          (r) => {
            if (r.cancelled) return { choice: 'cancel', label: '取消' } as T
            const res = (r.result || {}) as any
            return { choice: res.choice, label: res.label, feedback: res.feedback } as T
          },
          { choice: 'cancel', label: '取消' } as T,
        )
      }
      // Default: questions schema (ask_user_question) or generic questionnaire.
      const questions = buildAskQuestions()
      lastAskPayload = null
      interactArgs = null
      return createDialogPromise(
        emitReq,
        pending,
        { id, method: 'custom', kind: 'ask_user_question', questions },
        (r) => (r.cancelled ? { cancelled: true, answers: [] } : (r.result as T)),
        { cancelled: true, answers: [] } as T,
      )
    },

    pasteToEditor: () => {},
    setEditorText: () => {},
    getEditorText: () => '',
    editor: (title: string, prefill?: string) =>
      createDialogPromise(
        emitReq,
        pending,
        { id: randomUUID(), method: 'editor', title, prefill },
        (r) => (r.cancelled ? undefined : r.value),
        undefined,
      ),

    addAutocompleteProvider: () => {},
    setEditorComponent: () => {},
    getEditorComponent: () => undefined,

    get theme() {
      return {}
    },
    getAllThemes: () => [],
    getTheme: () => undefined,
    setTheme: () => ({ success: false, error: 'Theme switching not supported in desktop mode' }),
    getToolsExpanded: () => false,
    setToolsExpanded: () => {},
  }

  return {
    uiContext,
    handleExtensionUIResponse(response: ExtensionUIResponse) {
      const p = pending.get(response.id)
      if (!p) return
      p.cleanup()
      p.resolve(response)
    },
    setInteractArgs(schema, args) {
      interactArgs = args ? { schema, args } : null
    },
    dispose() {
      unsubAsk()
      interactArgs = null
      for (const p of pending.values()) {
        p.cleanup()
        p.reject(new Error('UI bridge disposed'))
      }
      pending.clear()
    },
  }
}