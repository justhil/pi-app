import { describe, expect, it } from 'vitest'
import { summarizeAppMemory } from './app-memory'

describe('summarizeAppMemory', () => {
  it('sums every process and groups them by role', () => {
    const m = summarizeAppMemory(
      [
        { pid: 1, type: 'Browser', memory: { workingSetSize: 100 } },
        { pid: 2, type: 'Tab', memory: { workingSetSize: 200 } },
        { pid: 3, type: 'Tab', memory: { workingSetSize: 50 } },
        { pid: 4, type: 'GPU', memory: { workingSetSize: 30 } },
        { pid: 5, type: 'Utility', serviceName: 'node.mojom.NodeService', memory: { workingSetSize: 400 } },
        { pid: 6, type: 'Utility', serviceName: 'network.mojom.NetworkService', memory: { workingSetSize: 20 } },
      ],
      new Set([3]),
    )
    expect(m.total).toBe(800 * 1024)
    expect(m.byKind).toEqual({ main: 102400, ui: 204800, sessions: 409600, browser: 51200, gpu: 30720, other: 20480 })
    expect(m.processes).toBe(6)
  })
})
