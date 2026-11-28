import { useTranslation } from 'react-i18next'
import {
  BookOpen,
  Boxes,
  Check,
  CheckCircle2,
  Loader2,
  MoreHorizontal,
  Plug,
  Plus,
  Puzzle,
  Settings,
  Sparkles,
  Terminal,
  Wrench,
  type AppIconComponent,
} from '@renderer/components/icons'
import { Switch } from '@renderer/components/ui/switch'
import { cn } from '@renderer/lib/utils'
import type { CuratedPluginCard, UnifiedPluginRow } from './use-plugins-hub-data'

const SKILL_ICON_MAP: Record<string, AppIconComponent> = {
  'book-open': BookOpen,
  sparkles: Sparkles,
  terminal: Terminal,
  wrench: Wrench,
  boxes: Boxes,
}

const DOT_COLOR: Record<'ok' | 'warn' | 'err', string> = {
  ok: 'bg-emerald-500',
  warn: 'bg-amber-500',
  err: 'bg-rose-500',
}

function PluginRowGlyph({ row }: { row: UnifiedPluginRow }) {
  const Icon =
    row.iconKind === 'mcp'
      ? Plug
      : row.iconKind === 'extension'
        ? Puzzle
        : (row.skillIcon && SKILL_ICON_MAP[row.skillIcon]) || Sparkles
  return (
    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-border/60 bg-foreground/[0.04] text-foreground/85">
      <Icon className="h-4 w-4" strokeWidth={1.7} />
    </div>
  )
}

export function InstalledPluginItem({ row }: { row: UnifiedPluginRow }) {
  const { t } = useTranslation()
  return (
    <div className="group flex items-center gap-3.5 rounded-xl px-3 py-2.5 transition-colors hover:bg-foreground/[0.04]">
      <PluginRowGlyph row={row} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-[13.5px] font-medium text-foreground">{row.title}</span>
          {row.statusDot ? (
            <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', DOT_COLOR[row.statusDot])} />
          ) : null}
        </div>
        <div className="mt-0.5 flex items-center gap-1.5 text-[12px] text-foreground-secondary/75">
          <span className="shrink-0 rounded bg-foreground/[0.07] px-1.5 py-0.5 text-[10.5px] font-medium text-foreground-secondary">
            {row.badge}
          </span>
          <span className="truncate">{row.subtitle}</span>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {row.canToggle && row.onToggle ? (
          <Switch
            checked={row.enabled}
            disabled={row.busy}
            onCheckedChange={(checked) => row.onToggle?.(checked)}
            aria-label={row.title}
          />
        ) : null}
        <button
          type="button"
          onClick={row.onConfigure}
          title={t('common:pluginsHub.configure')}
          aria-label={`${t('common:pluginsHub.configure')} ${row.title}`}
          className="flex h-7 w-7 items-center justify-center rounded-lg text-foreground-secondary/70 transition-colors hover:bg-foreground/[0.08] hover:text-foreground"
        >
          <MoreHorizontal className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}

export function CuratedIntegrationItem({ card }: { card: CuratedPluginCard }) {
  const { t } = useTranslation()
  return (
    <div className="group flex items-start gap-3.5 rounded-2xl border border-transparent px-3.5 py-3.5 transition-colors hover:border-border/50 hover:bg-foreground/[0.04]">
      <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-border/60 bg-primary/10 text-primary">
        <Boxes className="h-4 w-4" strokeWidth={1.7} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-[13.5px] font-semibold text-foreground">{card.title}</span>
          <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-foreground-secondary/70" strokeWidth={1.8} />
        </div>
        <p className="mt-0.5 line-clamp-2 text-[12px] leading-[1.45] text-foreground-secondary/80">
          {card.description}
        </p>
        <div className="mt-1 truncate text-[11px] text-foreground-secondary/55">{card.metaLine}</div>
      </div>
      <div className="shrink-0 pt-0.5">
        {card.installed ? (
          <button
            type="button"
            onClick={card.onConfigure}
            title={card.configurable ? t('common:pluginsHub.configure') : t('common:pluginsHub.installed')}
            className="flex h-7 w-7 items-center justify-center rounded-lg bg-foreground/[0.07] text-foreground-secondary transition-colors hover:bg-foreground/[0.12] hover:text-foreground"
          >
            {card.configurable ? <Settings className="h-3.5 w-3.5" /> : <Check className="h-3.5 w-3.5 text-emerald-500" />}
          </button>
        ) : (
          <button
            type="button"
            disabled={card.installing}
            onClick={card.onInstall}
            title={t('common:pluginsHub.install')}
            aria-label={`${t('common:pluginsHub.install')} ${card.title}`}
            className="flex h-7 w-7 items-center justify-center rounded-lg bg-foreground/[0.08] text-foreground transition-colors hover:bg-foreground/[0.16] disabled:opacity-50"
          >
            {card.installing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
          </button>
        )}
      </div>
    </div>
  )
}
