// Whole-app memory for the status bar: every Electron process of this app (main, windows, GPU,
// session workers, built-in browser pages), summed from app.getAppMetrics(). Workers that run
// outside the app (WSL) are not Electron processes and are not included.

export type MemoryKind = 'main' | 'ui' | 'sessions' | 'browser' | 'gpu' | 'other'

export interface ProcessMetricLike {
  pid: number
  type: string
  serviceName?: string
  memory: { workingSetSize: number }
}

export interface AppMemory {
  /** Bytes: sum of each process's resident set (shared pages count once per process). */
  total: number
  byKind: Record<MemoryKind, number>
  processes: number
}

export function summarizeAppMemory(metrics: ProcessMetricLike[], browserPids: ReadonlySet<number>): AppMemory {
  const byKind: Record<MemoryKind, number> = { main: 0, ui: 0, sessions: 0, browser: 0, gpu: 0, other: 0 }
  let total = 0
  for (const m of metrics) {
    const bytes = (m.memory?.workingSetSize ?? 0) * 1024
    total += bytes
    const kind: MemoryKind =
      m.type === 'Browser'
        ? 'main'
        : m.type === 'GPU'
          ? 'gpu'
          : m.type === 'Utility' && m.serviceName === 'node.mojom.NodeService'
            ? 'sessions'
            : m.type === 'Tab' || m.type === 'Renderer'
              ? browserPids.has(m.pid)
                ? 'browser'
                : 'ui'
              : 'other'
    byKind[kind] += bytes
  }
  return { total, byKind, processes: metrics.length }
}
