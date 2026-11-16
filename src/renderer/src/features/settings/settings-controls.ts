// 设置页控件类的唯一来源：pi / models / voice 各页共用，勿在页面内重新声明。

export const inputCls =
  'settings-field-focus w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm font-mono'

export const selectCls =
  'settings-field-focus max-w-full min-w-[10rem] rounded-md border border-border bg-background px-2.5 py-1.5 text-sm'

export const numberInputCls =
  'settings-field-focus w-[5.5rem] rounded-md border border-border bg-background px-2.5 py-1 text-right font-mono text-sm text-foreground'

export const textareaCls =
  'settings-field-focus w-full resize-y rounded-md border border-border bg-background px-3 py-2 font-mono text-sm leading-relaxed text-foreground'

export const btnCompact =
  'settings-chip inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-40'

export const btnOutline =
  'settings-chip inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-md border border-border bg-background px-2.5 py-1.5 text-sm transition-colors hover:bg-accent disabled:pointer-events-none disabled:opacity-40'

export const btnPrimary =
  'settings-chip inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-md bg-primary px-2.5 py-1.5 text-sm text-primary-foreground transition-colors disabled:pointer-events-none disabled:opacity-40'

export const btnDanger =
  'settings-chip inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-md border border-destructive/40 bg-background px-2.5 py-1.5 text-sm text-destructive transition-colors hover:bg-destructive/10 disabled:pointer-events-none disabled:opacity-40'
