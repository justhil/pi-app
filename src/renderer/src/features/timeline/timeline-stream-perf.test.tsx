/**
 * Render-cost benchmark (opt-in): PI_PERF=1 npx vitest run src/renderer/src/features/timeline/timeline-stream-perf.test.tsx
 * jsdom has no layout, so this measures the main-thread JS we control: React reconciliation,
 * Markdown/KaTeX parsing and timeline derivations per streaming frame.
 */
import { act, render } from '@testing-library/react'
import { Profiler } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { Timeline } from './timeline'
import { useUIStore } from '@renderer/stores/ui-store'
import type { TimelineItem } from '@renderer/stores/ui-store-types'

vi.mock('@renderer/lib/ipc-client', () => ({
  ipcClient: { invoke: vi.fn(async () => ({ items: [], totalCount: 0, sourceCount: 0 })) },
  onAppEvent: () => () => {},
}))
vi.mock('@renderer/lib/session-rewind', () => ({ navigateSessionToEntry: vi.fn(async () => true) }))
vi.mock('@renderer/lib/session-fork', () => ({ forkSessionFromEntry: vi.fn(async () => true) }))
vi.mock('@renderer/lib/reload-current-session-data', () => ({ reloadCurrentSessionData: vi.fn(async () => {}) }))
vi.mock('@renderer/lib/session-chrome', () => ({
  useSessionChrome: () => ({ canStop: true, showSpinner: true, sessionKey: '/tmp/proj/s.jsonl' }),
}))

const SECTION = [
  '## Step {n}: what changed',
  '',
  'The session worker keeps a **pool slot** per session. When the view switches, we capture the visible',
  'timeline and hydrate the next one from disk; see `session-shell.ts` for the cache rules.',
  '',
  '- keep the live cache bounded',
  '- never trust a foreground-only snapshot',
  '- prefer disk once a turn ends',
  '',
  '```ts',
  'export function example{n}(items: TimelineItem[]): number {',
  '  return items.filter((item) => item.type === "tool-call").length',
  '}',
  '```',
  '',
  '| field | meaning |',
  '| --- | --- |',
  '| sessionEntryId | JSONL entry id |',
  '| toolCallId | provider tool call id |',
  '',
].join('\n')

function answer(sections: number): string {
  return Array.from({ length: sections }, (_, n) => SECTION.replaceAll('{n}', String(n + 1))).join('\n')
}

function history(rows: number): TimelineItem[] {
  const out: TimelineItem[] = []
  for (let i = 0; i < rows; i++) {
    const user = i % 2 === 0
    out.push({
      id: `h-${i}`,
      type: user ? 'user-message' : 'assistant-message',
      text: user ? `question ${i}: please review the change set` : answer(1),
      timestamp: i * 1000,
      sessionEntryId: `e-${i}`,
    } as TimelineItem)
  }
  return out
}

function baseState(items: TimelineItem[]) {
  return {
    currentWorkspace: '/tmp/proj',
    historySessionFile: '/tmp/proj/s.jsonl',
    timelineItems: items,
    historyTotalCount: items.length,
    historyLoadedCount: items.length,
    historyLoading: false,
    streamingAssistantId: null,
    optimisticPendingUserText: null,
    agentTurnBootstrapping: false,
    runState: { status: 'running', toolCount: 0, errorCount: 0 } as never,
    sessionRuntimeRunning: { '/tmp/proj/s.jsonl': true },
    workerLiveSnapshot: { status: 'running', sessionFile: '/tmp/proj/s.jsonl', sessionId: 's' } as never,
  }
}

async function settleLazyMarkdown(): Promise<void> {
  await import('./markdown-view')
  for (let attempt = 0; attempt < 20; attempt++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    if (document.querySelector('.prose-chat')) return
  }
}

function stats(samples: number[]) {
  const sorted = [...samples].sort((a, b) => a - b)
  const sum = samples.reduce((acc, value) => acc + value, 0)
  const pct = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))]
  const fifth = Math.max(1, Math.floor(samples.length / 5))
  const avg = (part: number[]) => +(part.reduce((acc, value) => acc + value, 0) / part.length).toFixed(2)
  return {
    frames: samples.length,
    totalMs: +sum.toFixed(1),
    avgMs: +(sum / samples.length).toFixed(2),
    p95Ms: +pct(0.95).toFixed(2),
    maxMs: +sorted.at(-1)!.toFixed(2),
    firstFifthAvgMs: avg(samples.slice(0, fifth)),
    lastFifthAvgMs: avg(samples.slice(-fifth)),
  }
}

describe.skipIf(!process.env.PI_PERF)('timeline render cost', () => {
  it('S1 streaming a long answer into a 200-row session', async () => {
    Element.prototype.scrollIntoView = vi.fn()
    const base = history(200)
    useUIStore.setState(baseState(base))
    let commits = 0
    let reactMs = 0
    render(
      <Profiler id="timeline" onRender={(_id, _phase, actual) => { commits += 1; reactMs += actual }}>
        <Timeline />
      </Profiler>,
    )
    await settleLazyMarkdown()
    commits = 0
    reactMs = 0

    const full = answer(24)
    const step = Math.ceil(full.length / 200)
    const samples: number[] = []
    for (let end = step; end <= full.length + step; end += step) {
      const text = full.slice(0, Math.min(end, full.length))
      const started = performance.now()
      act(() => {
        useUIStore.setState({
          timelineItems: [...base, { id: 'stream', type: 'assistant-message', text, timestamp: 999_999 } as TimelineItem],
          streamingAssistantId: 'stream',
        })
      })
      samples.push(performance.now() - started)
    }
    const result = { ...stats(samples), answerChars: full.length, commits, reactMs: +reactMs.toFixed(1) }
    console.log('[perf] S1 streaming', JSON.stringify(result))
    expect(samples.length).toBeGreaterThan(100)
  }, 120_000)

  it('S3 streaming a short answer into a 1000-row loaded session', async () => {
    Element.prototype.scrollIntoView = vi.fn()
    const base = history(1000)
    useUIStore.setState(baseState(base))
    render(<Timeline />)
    await settleLazyMarkdown()
    const full = 'Short answer that keeps streaming one sentence at a time. '.repeat(40)
    const step = Math.ceil(full.length / 150)
    const samples: number[] = []
    for (let end = step; end <= full.length + step; end += step) {
      const text = full.slice(0, Math.min(end, full.length))
      const started = performance.now()
      act(() => {
        useUIStore.setState({
          timelineItems: [...base, { id: 'stream', type: 'assistant-message', text, timestamp: 9_999_999 } as TimelineItem],
          streamingAssistantId: 'stream',
        })
      })
      samples.push(performance.now() - started)
    }
    console.log('[perf] S3 long-session streaming', JSON.stringify({ ...stats(samples), loadedRows: 1000 }))
    expect(samples.length).toBeGreaterThan(100)
  }, 120_000)

  it('S4 streaming a large pi-ui table block', async () => {
    Element.prototype.scrollIntoView = vi.fn()
    const base = history(200)
    useUIStore.setState(baseState(base))
    render(<Timeline />)
    await settleLazyMarkdown()
    await import('../ui-blocks/runtime')
    const rows = Array.from({ length: 150 }, (_, index) => ({
      name: `package-${index}`,
      version: `1.${index % 7}.${index % 13}`,
      size: +(index * 3.7).toFixed(1),
      owner: index % 3 === 0 ? 'platform' : 'product',
    }))
    const block = JSON.stringify({ component: 'data-table', id: 'deps', props: { title: 'Dependencies', rows } }, null, 1)
    const full = `Here is the dependency audit you asked for.\n\n\`\`\`pi-ui\n${block}\n\`\`\`\n\nThe largest packages are listed first once you sort by size.`
    const step = Math.ceil(full.length / 200)
    const samples: number[] = []
    for (let end = step; end <= full.length + step; end += step) {
      const text = full.slice(0, Math.min(end, full.length))
      const started = performance.now()
      act(() => {
        useUIStore.setState({
          timelineItems: [...base, { id: 'stream', type: 'assistant-message', text, timestamp: 999_999 } as TimelineItem],
          streamingAssistantId: 'stream',
        })
      })
      samples.push(performance.now() - started)
    }
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    const rendered = document.querySelectorAll('.uib-table tbody tr').length
    console.log('[perf] S4 pi-ui streaming', JSON.stringify({ ...stats(samples), answerChars: full.length, renderedRows: rendered }))
    expect(rendered).toBe(10)
  }, 120_000)

  it('S2 first render of a 300-row session (switch)', async () => {
    Element.prototype.scrollIntoView = vi.fn()
    useUIStore.setState({ ...baseState([]), runState: { status: 'idle', toolCount: 0, errorCount: 0 } as never })
    await import('./markdown-view')
    const { unmount } = render(<Timeline />)
    await act(async () => {})
    const rows = history(300)
    const started = performance.now()
    act(() => {
      useUIStore.setState({ timelineItems: rows, historyTotalCount: 300, historyLoadedCount: 300 })
    })
    const ms = performance.now() - started
    const mountedRows = document.querySelectorAll('[data-timeline-item-id], .prose-chat').length
    console.log('[perf] S2 switch', JSON.stringify({ rows: 300, ms: +ms.toFixed(1), mountedMarkdown: mountedRows }))
    unmount()
    expect(ms).toBeGreaterThan(0)
  }, 120_000)
})
