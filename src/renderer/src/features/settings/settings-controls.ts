// 设置页控件类的唯一来源：pi / models / voice 各页共用，勿在页面内重新声明。

export const inputCls =
  'settings-field-focus w-full rounded-lg border border-border/80 bg-background px-2.5 py-1.5 text-[13px] font-mono transition-colors hover:border-border'

export const selectCls =
  'settings-field-focus max-w-full min-w-[10rem] rounded-lg border border-border/80 bg-background px-2.5 py-1.5 text-[13px] transition-colors hover:border-border'

export const numberInputCls =
  'settings-field-focus w-[5.5rem] rounded-lg border border-border/80 bg-background px-2.5 py-1 text-right font-mono text-[13px] text-foreground'

export const textareaCls =
  'settings-field-focus w-full resize-y rounded-lg border border-border/80 bg-background px-3 py-2 font-mono text-[12.5px] leading-relaxed text-foreground'

export const btnCompact =
  'settings-chip inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[12px] text-foreground-secondary transition-colors hover:bg-foreground/[0.06] hover:text-foreground disabled:pointer-events-none disabled:opacity-40'

export const btnOutline =
  'settings-chip inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border border-border/80 bg-background px-3 py-1.5 text-[13px] transition-colors hover:bg-foreground/[0.045] disabled:pointer-events-none disabled:opacity-40'

export const btnPrimary =
  'settings-chip inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg bg-primary px-3 py-1.5 text-[13px] font-medium text-primary-foreground transition-colors hover:opacity-92 disabled:pointer-events-none disabled:opacity-40'

export const btnDanger =
  'settings-chip inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border border-destructive/40 bg-background px-3 py-1.5 text-[13px] text-destructive transition-colors hover:bg-destructive/10 disabled:pointer-events-none disabled:opacity-40'
