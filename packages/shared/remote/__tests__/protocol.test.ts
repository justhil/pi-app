import { describe, expect, it } from 'vitest'
import { REMOTE_EVENTS } from '../events'
import { messageFixtures } from '../fixtures'
import { makeErr, makeEvt, makeOk, makePing, makeReq, parseFrame } from '../frames'
import { REMOTE_METHODS, isRemoteMethod, roleAllows } from '../methods'
import { TurnPatchSchema, TurnSchema } from '../timeline'
import { UiRequestSchema } from '../ui'

function schemaFor(name: string) {
  const [key, kind] = name.split('/')
  if (kind === 'event') return REMOTE_EVENTS[key as keyof typeof REMOTE_EVENTS]
  const m = REMOTE_METHODS[key as keyof typeof REMOTE_METHODS]
  return kind === 'params' ? m.params : m.result
}

describe('remote protocol schemas', () => {
  it('every fixture validates against its schema and round-trips through JSON', () => {
    const fixtures = messageFixtures()
    expect(fixtures.length).toBeGreaterThan(40)
    for (const f of fixtures) {
      const schema = schemaFor(f.schema)
      const parsed = schema.safeParse(JSON.parse(JSON.stringify(f.value)))
      expect(parsed.success, `${f.name}: ${parsed.success ? '' : parsed.error.message}`).toBe(true)
    }
  })

  it('covers every method and event', () => {
    const names = new Set(messageFixtures().map((f) => f.schema))
    for (const m of Object.keys(REMOTE_METHODS)) {
      expect(names.has(`${m}/params`)).toBe(true)
      expect(names.has(`${m}/result`)).toBe(true)
    }
    for (const e of Object.keys(REMOTE_EVENTS)) expect(names.has(`${e}/event`)).toBe(true)
  })

  it('rejects unknown fields and wrong discriminators', () => {
    const turn = messageFixtures().find((f) => f.name === 'method.turn.page.result')!.value as { turns: unknown[] }
    expect(TurnSchema.safeParse({ ...(turn.turns[0] as object), extra: 1 }).success).toBe(false)
    expect(TurnPatchSchema.safeParse({ op: 'nope', seq: 1 }).success).toBe(false)
    expect(UiRequestSchema.safeParse({ id: 'x', sessionKey: 's', method: 'custom', kind: 'other' }).success).toBe(false)
    expect(REMOTE_METHODS['turn.send'].params.safeParse({ sessionKey: 's', text: '', mode: 'prompt', clientMessageId: 'abcdefgh' }).success).toBe(false)
  })

  it('builds and parses envelopes', () => {
    for (const f of [makeReq('1', 'session.list', {}), makeOk('1', { a: 1 }), makeErr('1', 'forbidden', 'no'), makeEvt('turn.patch', {}), makePing('p')]) {
      expect(parseFrame(JSON.parse(JSON.stringify(f)))).toEqual(f)
    }
    expect(parseFrame({ v: 2, k: 'req', id: '1', m: 'x', p: {} })).toBeNull()
    expect(parseFrame({ v: 1, k: 'res', id: '1', ok: false, err: { code: 'weird', message: '', retryable: false } })).toBeNull()
  })

  it('roles and method lookup', () => {
    expect(isRemoteMethod('turn.send')).toBe(true)
    expect(isRemoteMethod('session.setPendingBind')).toBe(false)
    expect(isRemoteMethod('toString')).toBe(false)
    expect(roleAllows('viewer', REMOTE_METHODS['turn.send'].role)).toBe(false)
    expect(roleAllows('viewer', REMOTE_METHODS['session.open'].role)).toBe(true)
    expect(roleAllows('operator', REMOTE_METHODS['turn.send'].role)).toBe(true)
  })
})
