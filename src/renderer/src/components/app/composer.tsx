export function Composer() {
  return (
    <div className="border-t border-border p-3">
      <div className="flex items-end gap-2">
        <textarea
          className="flex-1 resize-none rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          placeholder="输入消息或 / 命令..."
          rows={1}
        />
        <button className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-all duration-motion-fast ease-motion-ease hover:bg-primary/90 active:scale-[0.98]">
          发送
        </button>
      </div>
    </div>
  )
}
