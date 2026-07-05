import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { ArrowUp, ArrowDown, CornerDownLeft } from 'lucide-react'
import { cn } from '@renderer/lib/utils'
import { OverlayScrollHost } from '@renderer/components/ui/overlay-scrollbar'
import {
  BUILTIN_CMD_I18N,
  CATEGORY_COLORS,
  CATEGORY_LABEL_I18N,
  type SlashCommand,
} from './composer-constants'

export function ComposerSlashPopover({
  show,
  anchorRef,
  text,
  filteredCommands,
  argCompletions,
  selectedIdx,
  setSelectedIdx,
  argIdx,
  setArgIdx,
  commandsSource,
  onAcceptCommand,
  onAcceptArg,
}: {
  show: boolean
  anchorRef: React.RefObject<HTMLDivElement | null>
  text: string
  filteredCommands: SlashCommand[]
  argCompletions: { label: string; description?: string }[]
  selectedIdx: number
  setSelectedIdx: (fn: (i: number) => number) => void
  argIdx: number
  setArgIdx: (fn: (i: number) => number) => void
  commandsSource: 'worker' | 'fallback' | null
  onAcceptCommand: (cmd: SlashCommand) => void
  onAcceptArg: (label: string) => void
}) {
  const { t } = useTranslation()
  const slashListScrollRef = useRef<HTMLDivElement>(null)
  const [layout, setLayout] = useState<{
    left: number
    width: number
    bottom: number
    listMaxPx: number
  } | null>(null)

  useEffect(() => {
    if (!show) {
      setLayout(null)
      return
    }
    const sync = () => {
      const el = anchorRef.current
      if (!el) return
      const r = el.getBoundingClientRect()
      const insetX = 16
      const gap = 8
      const footerPx = 36
      const bottom = Math.max(8, window.innerHeight - r.top + gap)
      const listMaxPx = Math.max(120, Math.min(320, r.top - gap - footerPx - 16))
      setLayout({
        left: r.left + insetX,
        width: Math.max(200, r.width - insetX * 2),
        bottom,
        listMaxPx,
      })
    }
    sync()
    const ro = new ResizeObserver(sync)
    const anchor = anchorRef.current
    if (anchor) ro.observe(anchor)
    window.addEventListener('resize', sync)
    window.addEventListener('scroll', sync, true)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', sync)
      window.removeEventListener('scroll', sync, true)
    }
  }, [show, text, anchorRef])

  useEffect(() => {
    if (!show) return
    const pane = slashListScrollRef.current
    if (!pane) return
    const row = pane.querySelector(`[data-slash-idx="${selectedIdx}"]`) as HTMLElement | null
    row?.scrollIntoView({ block: 'nearest' })
  }, [show, selectedIdx, filteredCommands.length])

  if (!show || !layout) return null

  return createPortal(
    <div
      data-slash-popover
      className="popover-motion flex flex-col overflow-hidden rounded-xl border border-border/70 bg-popover shadow-lg"
      style={{
        position: 'fixed',
        left: layout.left,
        width: layout.width,
        bottom: layout.bottom,
        zIndex: 10000,
        maxHeight: layout.listMaxPx + 40,
      }}
    >
      <div className="relative min-h-0 shrink-0" style={{ height: layout.listMaxPx }}>
        <OverlayScrollHost
          className="h-full"
          showRailOnHostHover
          scrollRef={slashListScrollRef}
          scrollClassName="composer-slash-popover-pane py-1 overscroll-contain"
        >
          {filteredCommands.map((cmd, idx) => (
            <button
              key={`${cmd.category}-${cmd.id}`}
              type="button"
              data-slash-idx={idx}
              onMouseEnter={() => setSelectedIdx(() => idx)}
              onClick={() => onAcceptCommand(cmd)}
              className={cn(
                'picker-row flex w-full min-h-[32px] items-center gap-2 px-3 py-1.5 text-left',
                idx === selectedIdx && 'bg-[var(--bg-active)]',
              )}
            >
              <span
                className={cn(
                  'composer-slash-cat-badge shrink-0 rounded-md text-[10px] font-semibold leading-none',
                  CATEGORY_COLORS[cmd.category],
                )}
              >
                {t(CATEGORY_LABEL_I18N[cmd.category] || 'composer:category.builtin')}
              </span>
              <span className="shrink-0 font-mono text-[12px] font-medium text-foreground">{cmd.name}</span>
              {(cmd.description || (cmd.category === 'builtin' && BUILTIN_CMD_I18N[cmd.id])) && (
                <span className="ml-auto truncate text-[11px] text-muted-foreground">
                  {cmd.category === 'builtin' ? t(BUILTIN_CMD_I18N[cmd.id] || '') : cmd.description}
                </span>
              )}
            </button>
          ))}
          {argCompletions.length > 0 && (
            <div className="border-t border-border/40 mt-1 pt-1">
              <div className="px-3 py-0.5 text-[9px] font-medium uppercase tracking-wide text-muted-foreground/50">
                {t('composer:argCompletion')}
              </div>
              {argCompletions.map((a, i) => (
                <button
                  key={i}
                  type="button"
                  onMouseEnter={() => setArgIdx(() => i)}
                  onClick={() => onAcceptArg(a.label)}
                  className={cn(
                    'picker-row flex w-full items-center gap-2 px-3 py-1.5 text-left',
                    i === argIdx && 'bg-[var(--bg-active)]',
                  )}
                >
                  <CornerDownLeft className="h-3 w-3 text-muted-foreground/50" />
                  <span className="font-mono text-[12px]">{a.label}</span>
                  {a.description && (
                    <span className="ml-auto truncate text-[11px] text-muted-foreground">{a.description}</span>
                  )}
                </button>
              ))}
            </div>
          )}
        </OverlayScrollHost>
      </div>
      <div className="flex shrink-0 items-center gap-3 border-t border-border/40 px-3 py-1.5 text-[10px] text-muted-foreground/70">
        <span className="flex items-center gap-1">
          <ArrowUp className="h-2.5 w-2.5" />
          <ArrowDown className="h-2.5 w-2.5" /> {t('composer:select')}
        </span>
        <span className="flex items-center gap-1">
          <CornerDownLeft className="h-2.5 w-2.5" /> {t('composer:confirm')}
        </span>
        <span className="flex items-center gap-1">{t('composer:tabComplete')}</span>
        <span>{t('composer:escClose')}</span>
        {commandsSource === 'fallback' && (
          <span className="ml-auto text-amber-600 dark:text-amber-400">{t('composer:offlineFallback')}</span>
        )}
      </div>
    </div>,
    document.body,
  )
}