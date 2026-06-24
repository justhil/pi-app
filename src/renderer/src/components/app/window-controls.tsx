import { useCallback, useEffect, useState } from 'react'
import { Minus, Square, X, Copy } from 'lucide-react'
import { cn } from '@renderer/lib/utils'
import { isMac } from '@renderer/lib/platform'

/** 无边框窗口：最小化 / 最大化(还原) / 关闭（Windows/Linux 顶栏右侧） */
export function WindowControls({ className }: { className?: string }) {
  const [maximized, setMaximized] = useState(false)

  const refresh = useCallback(() => {
    window.piDesktop?.invoke('ipc:window:isMaximized').then((r) => {
      if (r && typeof r.maximized === 'boolean') setMaximized(r.maximized)
    }).catch(() => {})
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  const minimize = () => void window.piDesktop?.invoke('ipc:window:minimize')
  const toggleMax = async () => {
    const r = await window.piDesktop?.invoke('ipc:window:maximize')
    if (r && typeof r.maximized === 'boolean') setMaximized(r.maximized)
    else refresh()
  }
  const close = () => void window.piDesktop?.invoke('ipc:window:close')

  if (isMac) return null

  return (
    <div className={cn('flex h-9 items-stretch', className)}>
      <button
        type="button"
        title="最小化"
        onClick={minimize}
        className="win-ctrl-btn flex w-11 items-center justify-center text-foreground-secondary hover:bg-[var(--bg-hover)]"
      >
        <Minus className="h-3.5 w-3.5" strokeWidth={1.75} />
      </button>
      <button
        type="button"
        title={maximized ? '还原' : '最大化'}
        onClick={toggleMax}
        className="win-ctrl-btn flex w-11 items-center justify-center text-foreground-secondary hover:bg-[var(--bg-hover)]"
      >
        {maximized ? (
          <Copy className="h-3 w-3 rotate-180" strokeWidth={1.75} />
        ) : (
          <Square className="h-3 w-3" strokeWidth={1.75} />
        )}
      </button>
      <button
        type="button"
        title="关闭"
        onClick={close}
        className="win-ctrl-btn flex w-11 items-center justify-center text-foreground-secondary hover:bg-red-600 hover:text-white"
      >
        <X className="h-3.5 w-3.5" strokeWidth={1.75} />
      </button>
    </div>
  )
}