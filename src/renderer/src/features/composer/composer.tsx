import { useState, useRef, useCallback, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Send, Square, ChevronDown } from 'lucide-react'
import { cn } from '@renderer/lib/utils'
import { ipcClient } from '@renderer/lib/ipc-client'
import { useUIStore } from '@renderer/stores/ui-store'

export function Composer() {
  const { t } = useTranslation()
  const [text, setText] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const sessionId = useUIStore((s) => s.currentSessionId)

  const autoResize = useCallback(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 200) + 'px'
  }, [])

  useEffect(() => {
    autoResize()
  }, [text, autoResize])

  const handleSend = async () => {
    if (!text.trim() || !sessionId) return
    setIsStreaming(true)
    try {
      await ipcClient.invoke('prompt.send', { sessionId, text: text.trim() })
    } catch (e) {
      console.error('Send failed:', e)
    }
    setText('')
    setIsStreaming(false)
  }

  const handleAbort = async () => {
    if (!sessionId) return
    try {
      await ipcClient.invoke('prompt.abort', { sessionId })
    } catch (e) {
      console.error('Abort failed:', e)
    }
    setIsStreaming(false)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      if (!isStreaming) handleSend()
    }
  }

  const handlePaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items
    if (!items) return
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        e.preventDefault()
        const file = item.getAsFile()
        if (!file) continue
        const reader = new FileReader()
        reader.onload = async () => {
          const base64 = (reader.result as string).split(',')[1]
          if (sessionId && text.trim()) {
            try {
              await ipcClient.invoke('prompt.sendWithImages', {
                sessionId,
                text: text.trim(),
                images: [{ name: file.name, mimeType: file.type, data: base64 }],
              })
            } catch (err) {
              console.error('Image send failed:', err)
            }
            setText('')
          }
        }
        reader.readAsDataURL(file)
        return
      }
    }
  }

  return (
    <div className="border-t border-border p-3">
      <div className="flex items-end gap-2">
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          className="flex-1 resize-none rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring transition-all duration-motion-fast ease-motion-ease"
          placeholder={t('composer.placeholder')}
          rows={1}
        />
        {isStreaming ? (
          <button
            onClick={handleAbort}
            className="flex items-center gap-1.5 rounded-md bg-destructive px-4 py-2 text-sm font-medium text-destructive-foreground transition-all duration-motion-fast ease-motion-ease hover:bg-destructive/90 active:scale-[0.98]"
          >
            <Square className="h-3.5 w-3.5 fill-current" />
            {t('composer.stop')}
          </button>
        ) : (
          <button
            onClick={handleSend}
            disabled={!text.trim() || !sessionId}
            className="flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-all duration-motion-fast ease-motion-ease hover:bg-primary/90 active:scale-[0.98] disabled:opacity-40 disabled:pointer-events-none"
          >
            <Send className="h-3.5 w-3.5" />
            {t('composer.send')}
          </button>
        )}
      </div>
    </div>
  )
}
