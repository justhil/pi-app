import { mkdtempSync, mkdirSync, readFileSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  __resetUsageCacheForTest,
  dayOf,
  queryUsageLogs,
  refreshUsage,
  sessionUsage,
  summarizeUsage,
} from './usage-scan'

const D = Date.UTC(2026, 9, 6) // 2026-10-06 00:00 UTC
const header = (cwd: string) => JSON.stringify({ type: 'session', id: 's', cwd, timestamp: '2026-10-01T00:00:00Z' })
const user = (text: string) => JSON.stringify({ type: 'message', id: 'u', message: { role: 'user', content: [{ type: 'text', text }] } })
const reply = (ts: number, model: string, input: number, output: number, cacheRead: number, cost: number) =>
  JSON.stringify({ type: 'message', id: `a${ts}`, message: { role: 'assistant', provider: 'anthropic', model, timestamp: ts, usage: { input, output, cacheRead, cacheWrite: 0, totalTokens: input + output + cacheRead, cost: { total: cost } } } })

function agentDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'pi-usage-'))
  mkdirSync(join(dir, 'sessions', '--work-a--'), { recursive: true })
  mkdirSync(join(dir, 'sessions', '--work-b--'), { recursive: true })
  writeFileSync(join(dir, 'sessions', '--work-a--', 's1.jsonl'), [header('/work/a'), user('fix   login'), reply(D + 3_600_000, 'sonnet-5', 100, 50, 900, 0.02), reply(D - 3_600_000, 'sonnet-5', 10, 5, 0, 0.001)].join('\n') + '\n')
  writeFileSync(join(dir, 'sessions', '--work-b--', 's2.jsonl'), [header('/work/b'), user('docs'), reply(D + 7_200_000, 'opus-5', 200, 100, 0, 0.1), 'not json'].join('\n') + '\n')
  return dir
}

describe('usage scan', () => {
  beforeEach(() => __resetUsageCacheForTest())

  it('aggregates by day, model, project and session', () => {
    const dir = agentDir()
    expect(refreshUsage(dir)).toEqual({ files: 2, read: 2 })
    const s = summarizeUsage(D - 86_400_000, D + 86_400_000, 0)
    expect(s.total).toMatchObject({ input: 310, output: 155, cacheRead: 900, cacheWrite: 0, calls: 3 })
    expect(s.total.cost).toBeCloseTo(0.121)
    expect(s.byDay.map((d) => [d.day, d.calls])).toEqual([['2026-10-05', 1], ['2026-10-06', 2]])
    expect(s.byModel.map((m) => [m.model, m.calls])).toEqual([['anthropic/opus-5', 1], ['anthropic/sonnet-5', 2]])
    expect(s.byProject.map((p) => p.project)).toEqual(['/work/b', '/work/a'])
    expect(s.topSessions[1]).toMatchObject({ title: 'fix login', project: '/work/a', calls: 2 })
    expect(s.cacheHitRate).toBeCloseTo(900 / 1210)
    // Range filter: today only.
    expect(summarizeUsage(D, D + 86_400_000, 0).total.calls).toBe(2)
  })

  it('re-reads only changed files', () => {
    const dir = agentDir()
    refreshUsage(dir)
    const f = join(dir, 'sessions', '--work-b--', 's2.jsonl')
    writeFileSync(f, [header('/work/b'), reply(D + 1, 'opus-5', 1, 1, 0, 0.5)].join('\n'))
    utimesSync(f, new Date(), new Date(Date.now() + 5000))
    expect(refreshUsage(dir)).toEqual({ files: 2, read: 1 })
    expect(summarizeUsage(D, D + 86_400_000, 0).total.cost).toBeCloseTo(0.52)
  })

  it('counts replies copied into a fork once, for the original session', () => {
    const dir = agentDir()
    const fork = join(dir, 'sessions', '--work-a--', 's1-fork.jsonl')
    const original = join(dir, 'sessions', '--work-a--', 's1.jsonl')
    const copied = readFileSync(original, 'utf8').split('\n').slice(2, 3) // first reply, same id + ts
    writeFileSync(fork, [JSON.stringify({ type: 'session', id: 'f', cwd: '/work/a', timestamp: '2026-10-05T00:00:00Z' }), user('forked'), ...copied, reply(D + 9_000_000, 'sonnet-5', 1, 1, 0, 0.3)].join('\n'))
    refreshUsage(dir)
    const s = summarizeUsage(D, D + 86_400_000, 0)
    expect(s.total.calls).toBe(3)
    expect(s.topSessions.find((x) => x.title === 'fix login')!.calls).toBe(1)
    expect(s.topSessions.find((x) => x.title === 'forked')!.calls).toBe(1)
  })

  it('also scans a custom sessionDir from settings.json and fills the weekday × hour grid', () => {
    const dir = agentDir()
    const custom = mkdtempSync(join(tmpdir(), 'pi-usage-custom-'))
    writeFileSync(join(dir, 'settings.json'), JSON.stringify({ sessionDir: custom }))
    writeFileSync(join(custom, 'cli.jsonl'), [header('/work/c'), user('from the cli'), reply(D + 3_600_000 * 5, 'opus-5', 10, 10, 0, 0.05)].join('\n'))
    expect(refreshUsage(dir).files).toBe(3)
    const s = summarizeUsage(0, D + 86_400_000, 0)
    expect(s.byProject.map((p) => p.project)).toContain('/work/c')
    expect(s.activeDays).toBe(2)
    expect(s.from).toBe(D - 86_400_000) // all time starts at the first reply's day
    // 2026-10-06 is a Tuesday (index 1); replies at 01:00, 02:00 and 05:00 UTC.
    expect([s.heat.calls[24 + 1], s.heat.calls[24 + 2], s.heat.calls[24 + 5]]).toEqual([1, 1, 1])
    expect(s.heat.calls.reduce((a, b) => a + b, 0)).toBe(s.total.calls)
  })

  it('buckets by local day and sums one session', () => {
    expect(dayOf(D - 60_000, 480)).toBe('2026-10-06') // 23:59 UTC is 07:59 in UTC+8
    const dir = agentDir()
    expect(sessionUsage(join(dir, 'sessions', '--work-a--', 's1.jsonl'))).toMatchObject({ calls: 2, input: 110 })
    expect(sessionUsage(join(dir, 'nope.jsonl'))).toBeNull()
  })

  it('should_compute_tps_ttft_cache_metrics_and_exclude_aborted_or_error_from_throughput_means_while_keeping_them_in_logs', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pi-usage-perf-'))
    mkdirSync(join(dir, 'sessions', '--proj--'), { recursive: true })
    const t0 = D + 10_000
    const lines = [
      header('/work/perf'),
      user('benchmark axonhub metrics'),
      // 1) Streamed thinking + text: duration=4000ms, ttft=1000ms -> decode=3000ms, output=300 (reasoning=100)
      //    totalTps = 300 / 4 = 75, genTps = 300 / 3 = 100
      JSON.stringify({
        type: 'message',
        id: 'm1',
        parentId: 'u',
        timestamp: new Date(t0 + 4005).toISOString(),
        message: {
          role: 'assistant',
          api: 'anthropic-messages',
          provider: 'anthropic',
          model: 'claude-opus-4-6',
          stopReason: 'stop',
          timestamp: t0,
          durationMs: 4000,
          ttftMs: 1000,
          firstTokenKind: 'thinking',
          usage: {
            input: 200,
            output: 300,
            reasoning: 100,
            cacheRead: 800,
            cacheWrite: 1000,
            cacheWrite1h: 400,
            totalTokens: 2300,
            cost: { input: 0.001, output: 0.015, cacheRead: 0.0008, cacheWrite: 0.005, total: 0.0218 },
          },
        },
      }),
      // 2) Legacy entry without durationMs/ttftMs, plus hidden server reasoning on a second modern entry:
      //    entry timestamp - message.timestamp = 2000ms, output=100 -> totalTps = 50
      JSON.stringify({
        type: 'message',
        id: 'm2',
        parentId: 'm1',
        timestamp: new Date(t0 + 12_000).toISOString(),
        message: {
          role: 'assistant',
          api: 'anthropic-messages',
          provider: 'anthropic',
          model: 'claude-opus-4-6',
          stopReason: 'toolUse',
          timestamp: t0 + 10_000,
          usage: {
            input: 100,
            output: 100,
            cacheRead: 900,
            cacheWrite: 0,
            totalTokens: 1100,
            cost: { total: 0.01 },
          },
        },
      }),
      // 3) Server-side hidden reasoning (firstTokenKind='text', reasoning=500, output=550, duration=5500ms, ttft=5000ms):
      //    Streamed visible tokens = 550 - 500 = 50 over 0.5s -> 100 tok/s (NOT 550/0.5 = 1100 tok/s!)
      JSON.stringify({
        type: 'message',
        id: 'm3',
        parentId: 'm2',
        timestamp: new Date(t0 + 25_500).toISOString(),
        message: {
          role: 'assistant',
          api: 'openai-responses',
          provider: 'openai',
          model: 'gpt-5.6',
          responseModel: 'gpt-5.6-2026-08',
          stopReason: 'stop',
          timestamp: t0 + 20_000,
          durationMs: 5500,
          ttftMs: 5000,
          firstTokenKind: 'text',
          usage: {
            input: 500,
            output: 550,
            reasoning: 500,
            cacheRead: 500,
            cacheWrite: 0,
            totalTokens: 1550,
            cost: { total: 0.03 },
          },
        },
      }),
      // 4) Aborted mid-flight: cost/tokens still count in total, kept in logs, but excluded from TTFT/TPS averages!
      JSON.stringify({
        type: 'message',
        id: 'm4',
        parentId: 'm3',
        timestamp: new Date(t0 + 30_100).toISOString(),
        message: {
          role: 'assistant',
          api: 'openai-responses',
          provider: 'openai',
          model: 'gpt-5.6',
          stopReason: 'aborted',
          errorMessage: 'Request aborted by user',
          timestamp: t0 + 30_000,
          durationMs: 100,
          ttftMs: 90,
          firstTokenKind: 'text',
          usage: {
            input: 50,
            output: 5,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 55,
            cost: { total: 0.002 },
          },
        },
      }),
    ]
    writeFileSync(join(dir, 'sessions', '--proj--', 'perf.jsonl'), lines.join('\n') + '\n')

    refreshUsage(dir)
    const s = summarizeUsage(D, D + 86_400_000, 0)

    expect(s.total.calls).toBe(4)
    expect(s.total.successCalls).toBe(3)
    expect(s.total.abortedCalls).toBe(1)
    expect(s.total.cacheWrite1h).toBe(400)
    // Total prompt = (200+800+1000) + (100+900+0) + (500+500+0) + (50+0+0) = 4050; cacheRead = 2200; cacheWrite = 1000
    expect(s.total.cacheHitRate).toBeCloseTo(2200 / 4050)
    expect(s.total.writeCacheRate).toBeCloseTo(1000 / 4050)

    // Completed calls only (m1, m2, m3):
    // durations = [4000, 2000, 5500] -> sum=11500ms, outputs = 300+100+550 = 950 -> totalTps = 950 / 11.5
    expect(s.total.durationCalls).toBe(3)
    expect(s.total.totalTps).toBeCloseTo(950 / 11.5, 2)
    // TTFT calls (m1=1000ms, m3=5000ms): avgTtftMs = 3000ms
    expect(s.total.ttftCalls).toBe(2)
    expect(s.total.avgTtftMs).toBe(3000)
    // Streaming decode: m1=(300 tok / 3.0s) + m3=(50 tok / 0.5s) = 350 tok / 3.5s = 100 tok/s
    expect(s.total.genTps).toBeCloseTo(100, 2)

    // Logs query: all 4 kept, filterable by status & sortable by tps
    const allLogs = queryUsageLogs({ from: D, to: D + 86_400_000, sortBy: 'ts', sortDir: 'desc' })
    expect(allLogs.totalCount).toBe(4)
    expect(allLogs.rows.map((r) => r.entryId)).toEqual(['m4', 'm3', 'm2', 'm1'])
    expect(allLogs.rows[1].genTps).toBeCloseTo(100, 2)
    expect(allLogs.rows[1].responseModel).toBe('gpt-5.6-2026-08')

    const abortedOnly = queryUsageLogs({ from: D, to: D + 86_400_000, status: 'aborted' })
    expect(abortedOnly.totalCount).toBe(1)
    expect(abortedOnly.rows[0].entryId).toBe('m4')
  })
})
