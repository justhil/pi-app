export function TopBar() {
  return (
    <div className="flex h-12 items-center justify-between border-b border-border px-4">
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium">pi Desktop</span>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground">Idle</span>
      </div>
    </div>
  )
}
