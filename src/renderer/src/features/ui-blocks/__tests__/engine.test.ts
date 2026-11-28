import { describe, expect, it } from 'vitest'
import {
  compileBlock,
  compileExpression,
  createBudget,
  expandPointProps,
  formulaToLatex,
  mergeState,
  parseBlockSource,
  parseExpression,
  parsePartialJSON,
  resolveBlock,
  scopeFromRecord,
  stateDiff,
  takeWhere,
} from '../engine'

describe('pi-ui V2 engine: partial-json, expression, templates & live blocks', () => {
  it('parses streaming truncated JSON, comments, trailing commas, and unescaped inner quotes', () => {
    const partial = parsePartialJSON('{"component":"panel","state":{"m":9},"children":[{"component":"text","text":"say "hi" ok",},{"component":"slider"')
    expect(partial.complete).toBe(false)
    const obj = partial.value as { component: string; children: Array<{ component: string; text?: string }> }
    expect(obj.component).toBe('panel')
    expect(obj.children).toHaveLength(2)
    expect(obj.children[0].text).toBe('say "hi" ok')
    expect(partial.closed.has(obj.children[0])).toBe(true)
    expect(partial.closed.has(obj.children[1])).toBe(false)
  })

  it('evaluates expressions safely without eval, enforces operator precedence & forbids prototype traversal', () => {
    const scope = scopeFromRecord({ a: 3, b: 4, items: [2, 4, 6] })
    expect(parseExpression('-2^2').evaluate(scope)).toBe(-4)
    expect(parseExpression('sqrt(a^2 + b^2)').evaluate(scope)).toBe(5)
    expect(parseExpression('avg(items) + len(items)').evaluate(scope)).toBe(7)
    expect(parseExpression('range(1, 4)').evaluate(scope)).toEqual([1, 2, 3, 4])
    expect(parseExpression('a > 2 ? "high" : "low"').evaluate(scope)).toBe('high')

    expect(() => parseExpression('items.__proto__').evaluate(scope)).toThrow(/not allowed/i)
    expect(() => parseExpression('range(1, 500)').evaluate(scopeFromRecord({}, createBudget(10)))).toThrow(/budget/i)

    const compiled = compileExpression('x^2 + 1')
    expect(compiled.evaluate({ x: 3 })).toBe(10)

    const tex = formulaToLatex('m * g', { name: 'F_g', unit: 'N', values: { m: 9, g: 9.8 }, precision: 1 })
    expect(tex.symbolic).toContain('F_{g}')
    expect(tex.worked).toContain('88.2')
    expect(tex.result).toBeCloseTo(88.2, 4)
  })

  it('compiles and resolves live blocks with topological computed values, per-point chart formulas, and where filters', () => {
    const raw = JSON.stringify({
      component: 'panel',
      id: 'calc-1',
      state: { rate: 10, minPrice: 20 },
      computed: {
        // Declared intentionally before dependency `base` to verify topological sorting.
        total: 'base * 2',
        base: 'rate + 5',
      },
      children: [
        { component: 'stat', label: 'Total', value: '{total}' },
        {
          component: 'chart',
          type: 'line',
          x: '{range(1, 3)}',
          series: [{ name: 'Growth', data: '{x * base}' }],
        },
        {
          component: 'data-table',
          where: '{row.price >= minPrice}',
          rows: [
            { name: 'A', price: 15 },
            { name: 'B', price: 25 },
          ],
        },
      ],
    })

    const parsed = parseBlockSource(raw, false)
    expect(parsed.status).toBe('ok')
    if (parsed.status !== 'ok') return
    expect(parsed.block.live).toBe(true)

    const compiled = compileBlock(parsed.block)
    const resolved = resolveBlock(compiled, compiled.initialState)
    expect(resolved.values.base).toBe(15)
    expect(resolved.values.total).toBe(30)

    const chartNode = resolved.root.children[1]
    const expandedChart = expandPointProps('chart', chartNode.props, [])
    expect((expandedChart.series as Array<{ data: number[] }>)[0].data).toEqual([15, 30, 45])

    const tableNode = resolved.root.children[2]
    const { where } = takeWhere('data-table', tableNode.props, [])
    expect(where?.({ name: 'A', price: 15 }, 0)).toBe(false)
    expect(where?.({ name: 'B', price: 25 }, 1)).toBe(true)

    // State merge & diff persistence
    const updated = mergeState(compiled.initialState, { rate: 20, unknown: 99 })
    expect(updated).toEqual({ rate: 20, minPrice: 20 })
    expect(stateDiff(compiled.initialState, updated)).toEqual({ rate: 20 })
  })
})
