import { mkdtempSync, mkdirSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { __resetUsageCacheForTest, dayOf, refreshUsage, sessionUsage, summarizeUsage } from './usage-scan'

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

  it('buckets by local day and sums one session', () => {
    expect(dayOf(D - 60_000, 480)).toBe('2026-10-06') // 23:59 UTC is 07:59 in UTC+8
    const dir = agentDir()
    expect(sessionUsage(join(dir, 'sessions', '--work-a--', 's1.jsonl'))).toMatchObject({ calls: 2, input: 110 })
    expect(sessionUsage(join(dir, 'nope.jsonl'))).toBeNull()
  })
})
