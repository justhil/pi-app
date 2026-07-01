import { useUIStore } from '@renderer/stores/ui-store'

function truncateLine(text: string, max = 120): string {
  const t = text.replace(/\s+/g, ' ').trim()
  if (t.length <= max) return t
  return `${t.slice(0, max)}…`
}

/** 对齐 pi TUI：运行中已入队 steer / follow-up，淡色显示在输入框上方 */
export function ComposerPendingQueue() {
  const steering = useUIStore((s) => s.pendingSteering)
  const followUp = useUIStore((s) => s.pendingFollowUp)
  if (steering.length === 0 && followUp.length === 0) return null

  return (
    <div
      className="composer-pending-queue mb-1.5 space-y-0.5 px-1 text-[12px] leading-snug text-foreground-secondary/55"
      aria-live="polite"
    >
      {steering.map((msg, i) => (
        <div key={`steer-${i}`} className="truncate font-mono">
          <span className="text-foreground-secondary/45">转向 · </span>
          {truncateLine(msg)}
        </div>
      ))}
      {followUp.map((msg, i) => (
        <div key={`fu-${i}`} className="truncate font-mono">
          <span className="text-foreground-secondary/45">排队 · </span>
          {truncateLine(msg)}
        </div>
      ))}
      <div className="text-[11px] text-foreground-secondary/40">
        Alt+↑ 拉回输入框 · 运行中 Esc 拉回并停止
      </div>
    </div>
  )
}