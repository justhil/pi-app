/** 排查提示音：DevTools 执行 localStorage.setItem('pi-alert-trace','1'); location.reload() */
export function alertTrace(tag: string, detail?: Record<string, unknown>): void {
  const on =
    typeof localStorage !== 'undefined' &&
    (localStorage.getItem('pi-alert-trace') === '1' || localStorage.getItem('pi-audio-trace') === '1')
  if (!on) return
  const line = detail ? `${tag} ${JSON.stringify(detail)}` : tag
  console.warn(`[alert-trace:renderer] ${line}`)
}