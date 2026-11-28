import { describe, expect, it } from 'vitest'
import {
  buildHomeUsageViewModel,
  computeUsageStreaks,
  formatHomeDuration,
  formatHomeTokens,
} from './home-usage-metrics'

describe('home-usage-metrics', () => {
  it('formats tokens in Chinese yi/wan and English K/M/B', () => {
    expect(formatHomeTokens(9_570_000_000, 'zh-CN')).toBe('95.7亿')
    expect(formatHomeTokens(450_000_000, 'zh-CN')).toBe('4.5亿')
    expect(formatHomeTokens(125_000, 'zh-CN')).toBe('12.5万')
    expect(formatHomeTokens(9_570_000_000, 'en')).toBe('9.57B')
    expect(formatHomeTokens(1_500_000, 'en')).toBe('1.5M')
  })

  it('formats longest task duration across languages', () => {
    const ms = (6 * 3600 + 55 * 60) * 1000
    expect(formatHomeDuration(ms, 'zh')).toBe('6 小时 55 分')
    expect(formatHomeDuration(ms, 'en')).toBe('6h 55m')
    expect(formatHomeDuration(ms, 'ru')).toBe('6 ч 55 мин')
    expect(formatHomeDuration(ms, 'ja-JP')).toBe('6 時間 55 分')
    expect(formatHomeDuration(null, 'zh')).toBe('—')
  })

  it('computes longest and current consecutive active days', () => {
    const today = new Date(2026, 10, 27).getTime()
    const streaks = computeUsageStreaks(
      ['2026-11-20', '2026-11-21', '2026-11-22', '2026-11-25', '2026-11-26'],
      today,
    )
    expect(streaks.longest).toBe(3)
    // Yesterday active keeps current streak alive even before today's first message
    expect(streaks.current).toBe(2)
  })

  it('builds 52 week columns and marks future cells', () => {
    const wed = new Date(2026, 10, 25, 14, 0, 0).getTime()
    const vm = buildHomeUsageViewModel(null, 42_000, wed)
    expect(vm.weeks).toHaveLength(52)
    const lastCol = vm.weeks[51]
    expect(lastCol.cells.some((c) => c.future)).toBe(true)
    expect(lastCol.cells.some((c) => !c.future)).toBe(true)
    expect(vm.longestTaskMs).toBe(42_000)
  })
})
