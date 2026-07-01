/** DevTools: localStorage.setItem('pi-audio-trace','1'); location.reload() */
const ON =
  import.meta.env.DEV &&
  (localStorage.getItem('pi-audio-trace') === '1' || sessionStorage.getItem('pi-audio-trace') === '1')

export function traceAudioRenderer(source: string, detail: Record<string, unknown> = {}): void {
  if (!ON) return
  console.log(`[audio-trace] ${source}`, detail)
}