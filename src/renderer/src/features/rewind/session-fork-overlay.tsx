import { useCallback, useEffect, useState } from 'react'
import { Loader2, X } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@renderer/lib/utils'
import { forkSessionFromEntry, loadForkCandidates } from '@renderer/lib/session-fork'

/** Selector for TUI /fork and double-Esc fork mode. */
export function SessionForkOverlay({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [messages, setMessages] = useState<Array<{ entryId: string; text: string }>>([])
  const [loading, setLoading] = useState(false)
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoading(true)
    void loadForkCandidates().then((list) => {
      if (cancelled) return
      setMessages(list)
      setSelectedIndex(Math.max(0, list.length - 1))
      setLoading(false)
      if (list.length === 0) {
        toast.info('没有可 Fork 的用户消息')
      }
    })
    return () => {
      cancelled = true
    }
  }, [open])

  const activate = useCallback(
    async (entryId: string) => {
      if (busy) return
      setBusy(true)
      try {
        onClose()
        await new Promise((r) => requestAnimationFrame(() => r(null)))
        await forkSessionFromEntry(entryId)
      } finally {
        setBusy(false)
      }
    },
    [busy, onClose],
  )

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
        return
      }
      if (messages.length === 0) return
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSelectedIndex((i) => Math.min(messages.length - 1, i + 1))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSelectedIndex((i) => Math.max(0, i - 1))
      } else if (e.key === 'Enter') {
        e.preventDefault()
        const row = messages[selectedIndex]
        if (row) void activate(row.entryId)
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [open, messages, selectedIndex, activate, onClose])

  if (!open) return null

  return (
    <div
      data-tree-overlay
      data-fork-overlay
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-[min(70vh,560px)] w-full max-w-lg flex-col overflow-hidden rounded-xl border border-border bg-background shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border/50 px-3 py-2">
          <div>
            <div className="text-[13px] font-medium">Fork 会话</div>
            <div className="text-[10px] text-muted-foreground">
              同 TUI <span className="font-mono">/fork</span> · 选一条用户消息 · Enter 确认 · Esc 关闭
            </div>
          </div>
          <button type="button" className="rounded p-1 hover:bg-muted" onClick={onClose} title="关闭">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="scrollbar-overlay min-h-0 flex-1 overflow-y-auto py-1">
          {loading ? (
            <div className="flex items-center gap-2 px-3 py-8 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              加载…
            </div>
          ) : messages.length === 0 ? (
            <p className="px-3 py-8 text-[12px] text-muted-foreground">暂无用户消息可 Fork</p>
          ) : (
            <ul className="px-1">
              {messages.map((m, index) => {
                const selected = index === selectedIndex
                const preview = (m.text || '').replace(/\s+/g, ' ').trim()
                const short = preview.length > 160 ? `${preview.slice(0, 160)}…` : preview
                return (
                  <li key={m.entryId}>
                    <button
                      type="button"
                      className={cn(
                        'flex w-full flex-col gap-0.5 rounded-md px-3 py-2 text-left text-[12px]',
                        selected && 'bg-primary/12 ring-1 ring-inset ring-primary/30',
                        !selected && 'hover:bg-muted/70',
                      )}
                      onClick={() => setSelectedIndex(index)}
                      onDoubleClick={() => void activate(m.entryId)}
                    >
                      <span className="font-mono text-[10px] text-muted-foreground">
                        {m.entryId.slice(0, 8)}
                      </span>
                      <span className="line-clamp-2 text-foreground-secondary">{short || '(空)'}</span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}
