import { useState, useRef, useCallback, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Send, Square, Paperclip } from 'lucide-react'
import { ipcClient } from '@renderer/lib/ipc-client'
import { useUIStore } from '@renderer/stores/ui-store'
import { cn } from '@renderer/lib/utils'

export function Composer() {
  const { t } = useTranslation()
  const [text, setText] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const currentWorkspace = useUIStore((s) => s.currentWorkspace)
  const isRunning = useUIStore((s) => s.runState.status === 'running')

  const autoResize = useCallback(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 200) + 'px'
  }, [])

  useEffect(() => {
    autoResize()
  }, [text, autoResize])

  useEffect(() => {
    setIsStreaming(isRunning)
  }, [isRunning])

  const handleSend = async () => {
    if (!text.trim() || !currentWorkspace) return
    setIsStreaming(true)
    try {
      await ipcClient.invoke('prompt.send', { sessionId: '', text: text.trim() })
    } catch (e) {
      console.error('Send failed:', e)
    }
    setText('')
  }

  const handleAbort = async () => {
    try {
      await ipcClient.invoke('prompt.abort', { sessionId: '' })
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
          if (currentWorkspace && text.trim()) {
            try {
              await ipcClient.invoke('prompt.sendWithImages', {
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
    <div className="border-t border-border/80 px-4 pb-3 pt-2.5">
      <div className={cn(
        'flex items-end gap-2 rounded-xl border bg-card transition-all duration-motion-fast ease-motion-ease',
        'border-border/70 focus-within:border-ring/50 focus-within:ring-1 focus-within:ring-ring/30',
      )}>
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          className="flex-1 resize-none bg-transparent px-3.5 py-2.5 text-[13px] leading-relaxed placeholder:text-muted-foreground/50 focus-visible:outline-none"
          placeholder={currentWorkspace ? t('composer.placeholder') : t('composer.selectProjectFirst')}
          rows={1}
          disabled={!currentWorkspace}
        />
        {isStreaming ? (
          <button
            onClick={handleAbort}
            className="m-1.5 flex items-center gap-1.5 rounded-lg bg-destructive px-3 py-1.5 text-[12px] font-medium text-destructive-foreground transition-all duration-motion-fast ease-motion-ease hover:bg-destructive/90 active:scale-[0.97]"
          >
            <Square className="h-3 w-3 fill-current" />
            {t('composer.stop')}
          </button>
        ) : (
          <button
            onClick={handleSend}
            disabled={!text.trim() || !currentWorkspace}
            className="m-1.5 flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-[12px] font-medium text-primary-foreground transition-all duration-motion-fast ease-motion-ease hover:bg-primary/90 active:scale-[0.97] disabled:opacity-30 disabled:pointer-events-none"
          >
            <Send className="h-3 w-3" />
            {t('composer.send')}
          </button>
        )}
      </div>
    </div>
  )
}
