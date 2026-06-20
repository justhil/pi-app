/** 同一帧内多次调用只执行一次 fn（用于 scroll / resize 通知） */
export function rafThrottle(fn: () => void): () => void {
  let scheduled = false
  return () => {
    if (scheduled) return
    scheduled = true
    requestAnimationFrame(() => {
      scheduled = false
      fn()
    })
  }
}