import { useLayoutEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { RotateCcw, Send } from '@renderer/components/icons'
import { sendComposerPrompt } from '@renderer/lib/send-composer-prompt'
import { quoteCanvasToComposer } from '@renderer/features/canvas/canvas-store'

const ASK_MAX_LENGTH = 2000
const ASK_MAX_HEIGHT = 140

/**
 * Editable follow-up composer embedded inside Live Panel `button.ask` nodes.
 * Tracks reactive template updates until the user edits it; pressing Enter sends directly to the active session.
 */
export function UIBlockAsk({ suggestion }: { suggestion: string }) {
  const [draft, setDraft] = useState(suggestion)
  const [edited, setEdited] = useState(false)
  const [lastSuggestion, setLastSuggestion] = useState(suggestion)
  const [sending, setSending] = useState(false)

  if (suggestion !== lastSuggestion) {
    setLastSuggestion(suggestion)
    if (!edited) setDraft(suggestion)
  }

  const fieldRef = useRef<HTMLTextAreaElement | null>(null)
  useLayoutEffect(() => {
    const field = fieldRef.current
    if (!field) return
    field.style.height = 'auto'
    field.style.height = `${Math.min(field.scrollHeight, ASK_MAX_HEIGHT)}px`
  }, [draft])

  const text = draft.trim()
  const canSend = !sending && text !== ''

  const submit = async () => {
    if (!canSend) return
    setSending(true)
    try {
      const ok = await sendComposerPrompt(text)
      if (!ok) {
        quoteCanvasToComposer(text)
        toast.message('已填入输入框，可选择会话后发送')
      }
      setEdited(false)
      setDraft(suggestion)
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="uib-ask-bar">
      <textarea
        ref={fieldRef}
        rows={1}
        value={draft}
        maxLength={ASK_MAX_LENGTH}
        aria-label="编辑并发送追问"
        placeholder="输入或修改追问，回车发送…"
        onChange={(e) => {
          setDraft(e.target.value)
          setEdited(true)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && e.keyCode !== 229) {
            e.preventDefault()
            void submit()
          }
        }}
        className="uib-ask-input"
      />
      {edited && draft !== suggestion ? (
        <button
          type="button"
          onClick={() => {
            setEdited(false)
            setDraft(suggestion)
          }}
          aria-label="恢复默认追问"
          title="恢复默认追问"
          className="uib-ask-icon-btn"
        >
          <RotateCcw className="h-3.5 w-3.5" />
        </button>
      ) : null}
      <button
        type="button"
        onClick={() => void submit()}
        disabled={!canSend}
        aria-label="发送追问"
        title="发送追问 (Enter)"
        className="uib-ask-send-btn"
      >
        <Send className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}
