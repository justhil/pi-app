import { useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import {
  FileDiff,
  Folder,
  Globe,
  Layers,
  MoreHorizontal,
  Search,
  Terminal,
  type AppIconComponent,
} from '@renderer/components/icons'
import { isStageRightPanelId } from '@shared/right-panels'
import { normalizeAddressInput } from '@shared/browser-types'
import { browserActions } from '@renderer/features/browser/browser-store'
import { terminalActions } from '@renderer/features/terminal/terminal-store'
import {
  useAnchoredMenuPosition,
  useDismissContextMenu,
} from '@renderer/features/workspace/context-menu-shared'
import { useUIStore } from '@renderer/stores/ui-store'
import { cn } from '@renderer/lib/utils'
import type { RightDockTabItem } from './right-dock'

interface RightDockLaunchpadProps {
  allAvailableTabs: RightDockTabItem[]
  onOpenPanel: (panelId: string) => void
}

function looksLikeUrl(input: string): boolean {
  const s = input.trim()
  if (!s) return false
  if (/^(https?:\/\/|localhost[:/]|127\.0\.0\.1|about:)/i.test(s)) return true
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+(:\d+)?(\/.*)?$/i.test(s)
}

/** Codex-style right pane new-tab launchpad: optical upper-center gravity, pure pill input & soft borderless 2x2 cards. */
export function RightDockLaunchpad({
  allAvailableTabs,
  onOpenPanel,
}: RightDockLaunchpadProps) {
  const { t } = useTranslation()
  const [query, setQuery] = useState('')
  const [moreOpen, setMoreOpen] = useState(false)
  const moreBtnRef = useRef<HTMLButtonElement>(null)
  const moreMenuRef = useRef<HTMLDivElement>(null)
  const showSearch = useUIStore((s) => s.uiCustomization.shellLaunchpadShowSearch)
  const compact = useUIStore((s) => s.uiCustomization.shellLaunchpadCompact)

  useDismissContextMenu(moreOpen, moreMenuRef, () => setMoreOpen(false), moreBtnRef)
  const moreMenuPos = useAnchoredMenuPosition(moreOpen, moreBtnRef, moreMenuRef, { align: 'end', gap: 6 })

  const trimmed = query.trim()
  const tabByKey = useMemo(
    () => new Map(allAvailableTabs.map((item) => [item.key, item])),
    [allAvailableTabs],
  )

  const filteredTabs = useMemo(() => {
    if (!trimmed) return []
    const q = trimmed.toLowerCase()
    return allAvailableTabs.filter(
      (item) => item.label.toLowerCase().includes(q) || item.key.toLowerCase().includes(q),
    )
  }, [allAvailableTabs, trimmed])

  const openUrlInBrowser = (raw: string) => {
    const url = normalizeAddressInput(raw, 'https://www.google.com/search?q=%s')
    onOpenPanel('browser')
    if (url && url !== 'about:blank') {
      void browserActions.openTab(url).catch(() => {})
    }
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!trimmed) return
    if (looksLikeUrl(trimmed)) {
      openUrlInBrowser(trimmed)
      setQuery('')
      return
    }
    if (filteredTabs.length > 0) {
      onOpenPanel(filteredTabs[0].key)
      setQuery('')
      return
    }
    if (tabByKey.has('files')) {
      onOpenPanel('files')
      setQuery('')
    } else {
      openUrlInBrowser(trimmed)
      setQuery('')
    }
  }

  const quickCards = useMemo(() => {
    const cards: Array<{
      key: string
      label: string
      icon: AppIconComponent
      onClick: () => void
    }> = [
      {
        key: 'terminal',
        label: t('common:topbar.terminal'),
        icon: Terminal,
        onClick: () => terminalActions.setOpen(true),
      },
      {
        key: 'canvas',
        label: tabByKey.get('canvas')?.label || t('common:panel.canvas'),
        icon: Layers,
        onClick: () => onOpenPanel('canvas'),
      },
      {
        key: 'browser',
        label: tabByKey.get('browser')?.label || t('common:panel.browser'),
        icon: Globe,
        onClick: () => onOpenPanel('browser'),
      },
      tabByKey.has('review')
        ? {
            key: 'review',
            label: tabByKey.get('review')?.label || t('common:panel.review'),
            icon: FileDiff,
            onClick: () => onOpenPanel('review'),
          }
        : {
            key: 'files',
            label: tabByKey.get('files')?.label || t('common:panel.files'),
            icon: Folder,
            onClick: () => onOpenPanel('files'),
          },
    ]
    return cards
  }, [onOpenPanel, t, tabByKey])

  const extraTabs = useMemo(
    () => allAvailableTabs.filter((item) => !quickCards.some((c) => c.key === item.key)),
    [allAvailableTabs, quickCards],
  )

  return (
    <div
      data-pi-slot="right-dock-launchpad"
      className={cn(
        'flex h-full min-h-0 flex-col items-center overflow-y-auto bg-[var(--bg-base)] px-6 pb-12 select-none',
        compact ? 'pt-[12vh]' : 'pt-[18vh]',
      )}
    >
      <div className="w-full max-w-[368px]">
        {/* Crisp floating pill search / URL bar */}
        {showSearch ? (
          <form onSubmit={handleSubmit} className="relative">
            <Search
              className="pointer-events-none absolute left-4 top-1/2 h-[15px] w-[15px] -translate-y-1/2 text-foreground-secondary/60"
              strokeWidth={1.65}
              aria-hidden
            />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('common:panel.launchpadSearchPlaceholder')}
              aria-label={t('common:panel.launchpadSearchPlaceholder')}
              className="launchpad-search-input h-11 w-full rounded-full border border-foreground/[0.09] bg-[var(--bg-base)] pl-11 pr-4 text-[13px] text-foreground shadow-[0_1px_3px_rgba(0,0,0,0.03)] outline-none transition-all placeholder:text-foreground-secondary/50 hover:border-foreground/[0.15] focus:border-foreground/[0.22] focus:shadow-[0_3px_12px_rgba(0,0,0,0.05)]"
            />

            {trimmed && (filteredTabs.length > 0 || looksLikeUrl(trimmed)) ? (
              <div className="absolute left-0 right-0 top-[52px] z-30 max-h-[280px] overflow-y-auto overscroll-contain rounded-2xl border border-border/60 bg-popover p-1.5 text-[12.5px] text-popover-foreground shadow-xl">
                {looksLikeUrl(trimmed) ? (
                  <button
                    type="button"
                    onClick={() => {
                      openUrlInBrowser(trimmed)
                      setQuery('')
                    }}
                    className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left hover:bg-[var(--bg-hover)]"
                  >
                    <Globe className="h-4 w-4 shrink-0 text-foreground-secondary" strokeWidth={1.6} />
                    <span className="truncate">{t('common:panel.launchpadOpenUrl', { url: trimmed })}</span>
                  </button>
                ) : null}
                {filteredTabs.map((item) => {
                  const Icon = item.icon
                  return (
                    <button
                      key={item.key}
                      type="button"
                      onClick={() => {
                        onOpenPanel(item.key)
                        setQuery('')
                      }}
                      className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left hover:bg-[var(--bg-hover)]"
                    >
                      {Icon ? <Icon className="h-4 w-4 shrink-0 text-foreground-secondary" strokeWidth={1.6} /> : null}
                      <span className="min-w-0 flex-1 truncate">{item.label}</span>
                      <span className="text-[11px] text-foreground-secondary/55">
                        {isStageRightPanelId(item.key) ? t('common:panel.stageGroup') : t('common:panel.inspectorGroup')}
                      </span>
                    </button>
                  )
                })}
              </div>
            ) : null}
          </form>
        ) : null}

        {/* Section header: "打开" + overflow menu */}
        <div className={cn('flex items-center justify-between px-0.5', showSearch ? 'mt-8' : 'mt-2')}>
          <span className="text-[12px] font-normal text-foreground-secondary/75">
            {t('common:panel.launchpadOpenHeading')}
          </span>
          {extraTabs.length > 0 ? (
            <div className="relative">
              <button
                ref={moreBtnRef}
                type="button"
                onClick={() => setMoreOpen((v) => !v)}
                aria-expanded={moreOpen}
                aria-label={t('common:panel.openTab')}
                title={t('common:panel.openTab')}
                className="flex h-6 w-6 items-center justify-center rounded-md text-foreground-secondary/65 transition-colors hover:bg-foreground/[0.05] hover:text-foreground"
              >
                <MoreHorizontal className="h-4 w-4" />
              </button>
              {moreOpen && typeof document !== 'undefined'
                ? createPortal(
                    <div
                      ref={moreMenuRef}
                      role="menu"
                      data-browser-overlay=""
                      style={moreMenuPos}
                      onPointerDown={(e) => e.stopPropagation()}
                      className="electron-no-drag fixed z-[500] w-[196px] overflow-x-hidden overflow-y-auto overscroll-contain rounded-xl border border-border/65 bg-popover p-1.5 text-[12.5px] text-popover-foreground shadow-xl"
                    >
                      {extraTabs.map((item) => {
                        const Icon = item.icon
                        return (
                          <button
                            key={item.key}
                            type="button"
                            role="menuitem"
                            onClick={() => {
                              setMoreOpen(false)
                              onOpenPanel(item.key)
                            }}
                            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left hover:bg-[var(--bg-hover)]"
                          >
                            {Icon ? <Icon className="h-3.5 w-3.5 shrink-0 opacity-75" strokeWidth={1.6} /> : null}
                            <span className="truncate">{item.label}</span>
                          </button>
                        )
                      })}
                    </div>,
                    document.body,
                  )
                : null}
            </div>
          ) : null}
        </div>

        {/* 2x2 generous soft-fill cards (or compact horizontal tiles) */}
        <div className={cn('mt-3 grid grid-cols-2', compact ? 'gap-2' : 'gap-3')}>
          {quickCards.map((card) => {
            const Icon = card.icon
            return (
              <button
                key={card.key}
                type="button"
                onClick={card.onClick}
                className={cn(
                  'launchpad-tile group flex text-left transition-colors bg-foreground/[0.04] hover:bg-foreground/[0.075]',
                  compact
                    ? 'min-h-[52px] flex-row items-center gap-2.5 rounded-xl px-3.5 py-2.5'
                    : 'min-h-[88px] flex-col items-start justify-between rounded-2xl p-4',
                )}
              >
                <Icon
                  className="h-[17px] w-[17px] shrink-0 text-foreground/75 transition-colors group-hover:text-foreground"
                  strokeWidth={1.6}
                />
                <span className="truncate text-[13px] font-medium text-foreground/90">{card.label}</span>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
