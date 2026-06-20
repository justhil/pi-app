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
  /** Cache ask_user_question tool args for preview text (R1-1). */
  setAskToolQuestions: (questions: unknown[] | null) => void
  /** Cache image_review tool args so custom() can build a desktop review dialog. */
  setImageReviewArgs: (args: { image: string; title?: string; question?: string; context?: string; options?: string[]; allow_feedback?: boolean } | null) => void
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
  /** Full questions from ask_user_question tool args (includes option.preview; event omits preview text). */
  let lastAskToolQuestions: unknown[] | null = null
  /** Cached image_review tool args so custom() can render a desktop review overlay. */
  let imageReviewArgs: {
    image: string; title?: string; question?: string; context?: string
    options?: string[]; allow_feedback?: boolean
  } | null = null

  const emitReq = (req: ExtensionUIRequest) => {
    onRequest(req)
  }

  const unsubAsk = eventBus.on(ASK_USER_PROMPT_EVENT, (payload: { questions: unknown }) => {
    lastAskPayload = payload
  })

  const mergeAskQuestionsForUi = (): unknown[] => {
    const eventQs = (lastAskPayload?.questions as any[]) || []
    const toolQs = (lastAskToolQuestions as any[]) || []
    if (toolQs.length === 0) return eventQs
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
      // image_review tool: pi-image-gen's showReviewOverlay uses a native TUI custom factory the
      // desktop cannot execute; route to a dedicated desktop review dialog using cached tool args.
      if (imageReviewArgs) {
        const a = imageReviewArgs
        imageReviewArgs = null
        const opts = (a.options && a.options.length > 0)
          ? a.options.slice(0, 4)
          : ['通过', '需要修改', '重做', '取消']
        const req: ExtensionUIRequest = {
          id, method: 'custom', kind: 'image_review',
          image: a.image,
          title: a.title?.trim() || '图片审查',
          question: a.question?.trim() || '这张图片是否可用？',
          context: a.context?.trim() || undefined,
          options: opts,
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
      const questions = mergeAskQuestionsForUi()
      lastAskPayload = null
      lastAskToolQuestions = null
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
    setAskToolQuestions(questions: unknown[] | null) {
      lastAskToolQuestions = questions
    },
    setImageReviewArgs(args) {
      imageReviewArgs = args
    },
    dispose() {
      unsubAsk()
      lastAskToolQuestions = null
      for (const p of pending.values()) {
        p.cleanup()
        p.reject(new Error('UI bridge disposed'))
      }
      pending.clear()
    },
  }
}