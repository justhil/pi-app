import { beforeEach, describe, expect, it } from 'vitest'
import { claimEntryAnimation, clearBlockStateForTests, contentHash } from '../block-state'
import { bracketsBalanced, parseUIBlock, repairJSON } from '../envelope'
import { peekComponentName, peekItemCount, uiBlockLanguageFromClassName } from '../protocol'
import { v, validate } from '../schema'

describe('protocol', () => {
  it('recognises pi-ui and deeix-ui fences only', () => {
    expect(uiBlockLanguageFromClassName('language-pi-ui')).toBe('pi-ui')
    expect(uiBlockLanguageFromClassName('foo language-DEEIX-UI')).toBe('deeix-ui')
    expect(uiBlockLanguageFromClassName('language-pi')).toBeNull()
    expect(uiBlockLanguageFromClassName('language-json')).toBeNull()
    expect(uiBlockLanguageFromClassName(undefined)).toBeNull()
  })

  it('peeks the component and item count from a partial body', () => {
    const partial = '{"component": "data-table", "props": {"rows": [{"a": 1}, {"a": 2}, {"a'
    expect(peekComponentName(partial)).toBe('data-table')
    expect(peekItemCount(partial)).toBe(3)
    expect(peekComponentName('{"compo')).toBeNull()
  })
})

describe('parseUIBlock', () => {
  it('parses an envelope and fills defaults', () => {
    const parsed = parseUIBlock('{"component":"chart","props":{"type":"bar"},"version":"v1"}', false)
    expect(parsed).toEqual({
      status: 'ok',
      envelope: { component: 'chart', id: 'chart', version: 1, props: { type: 'bar' } },
    })
  })

  it('treats an unbalanced body as incomplete while streaming, invalid once settled', () => {
    const raw = '{"component":"chart","props":{"series":[1,2'
    expect(parseUIBlock(raw, true).status).toBe('incomplete')
    expect(parseUIBlock(raw, false).status).toBe('invalid')
    expect(parseUIBlock('', true).status).toBe('incomplete')
  })

  it('reports shape problems', () => {
    expect(parseUIBlock('[1,2]', false)).toMatchObject({ status: 'invalid', message: 'expected a JSON object' })
    expect(parseUIBlock('{"props":{}}', false)).toMatchObject({ status: 'invalid', message: 'missing "component"' })
    expect(parseUIBlock('{"component":"x","props":[]}', false)).toMatchObject({ status: 'invalid' })
  })

  it('repairs common model JSON slips', () => {
    const sloppy = `{
      // chart of things
      "component": "stat-grid",
      "id": 7,
      "props": { "items": [ { "label": "他说"很好"", "value": "1", }, ], /* done */ },
    }`
    const parsed = parseUIBlock(sloppy, false)
    expect(parsed.status).toBe('ok')
    if (parsed.status !== 'ok') return
    expect(parsed.envelope.id).toBe('7')
    expect(parsed.envelope.props).toEqual({ items: [{ label: '他说"很好"', value: '1' }] })
  })

  it('escapes raw newlines and tabs inside strings', () => {
    expect(JSON.parse(repairJSON('{"a":"x\ny\tz"}'))).toEqual({ a: 'x\ny\tz' })
  })

  it('balances brackets while ignoring ones inside strings', () => {
    expect(bracketsBalanced('{"a":"}{]["}')).toBe(true)
    expect(bracketsBalanced('{"a":"\\"}"')).toBe(false)
    expect(bracketsBalanced('{"a":[1,2]')).toBe(false)
  })
})

describe('schema', () => {
  it('coerces loose scalars and keeps paths for failures', () => {
    const schema = v.object<{ n: number; b: boolean; s: string; e: 'a' | 'b'; list?: Array<number | null> }>({
      n: v.number(),
      b: v.boolean(),
      s: v.string(),
      e: v.enum(['a', 'b'] as const),
      list: v.optional(v.array(v.nullableNumber(), { max: 2 })),
    })
    expect(validate(schema, { n: '1,200', b: 'true', s: 3, e: ' B ', list: [1, null, 3] })).toEqual({
      ok: true,
      value: { n: 1200, b: true, s: '3', e: 'b', list: [1, null] },
    })
    const bad = validate(schema, { n: 'x', b: true, e: 'c' })
    expect(bad.ok).toBe(false)
    if (bad.ok) return
    expect(bad.issues.map((issue) => issue.path)).toEqual(['$.n', '$.s', '$.e'])
  })

  it('supports unions, custom checks and array minimums', () => {
    const idOrList = v.union<string | string[]>(v.string(), v.array(v.string()))
    expect(validate(idOrList, ['a'])).toEqual({ ok: true, value: ['a'] })
    expect(validate(idOrList, 'a')).toEqual({ ok: true, value: 'a' })
    const even = v.custom((value) => (typeof value === 'number' && value % 2 === 0 ? value : undefined), 'expected even')
    expect(validate(even, 0)).toEqual({ ok: true, value: 0 })
    expect(validate(even, 3)).toMatchObject({ ok: false, issues: [{ message: 'expected even' }] })
    expect(validate(v.array(v.number(), { min: 1 }), [])).toMatchObject({ ok: false })
  })
})

describe('block state', () => {
  beforeEach(() => clearBlockStateForTests())

  it('animates the first live appearance and resumes on a quick remount', () => {
    expect(claimEntryAnimation('k', true, 1000)).toEqual({ animate: true, elapsed: 0 })
    expect(claimEntryAnimation('k', true, 1300)).toEqual({ animate: true, elapsed: 300 })
    expect(claimEntryAnimation('k', false, 3000)).toEqual({ animate: false, elapsed: 0 })
  })

  it('never animates a block first seen in history', () => {
    expect(claimEntryAnimation('h', false, 1000)).toEqual({ animate: false, elapsed: 0 })
    expect(claimEntryAnimation('h', true, 1001)).toEqual({ animate: false, elapsed: 0 })
  })

  it('hashes content stably', () => {
    expect(contentHash('abc')).toBe(contentHash('abc'))
    expect(contentHash('abc')).not.toBe(contentHash('abd'))
  })
})
