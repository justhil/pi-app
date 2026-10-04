import { describe, expect, it } from 'vitest'
import { encodeDefaultTools, resolveDefaultTools, withTool } from './default-tools'

const sorted = (s: Set<string>) => [...s].sort()

describe('defaultTools', () => {
  it('resolves unset, plain lists and +/- changes like pi does', () => {
    expect(sorted(resolveDefaultTools(undefined))).toEqual(['bash', 'edit', 'read', 'write'])
    expect(sorted(resolveDefaultTools(['read', 'grep']))).toEqual(['grep', 'read'])
    expect(sorted(resolveDefaultTools(['+codemode', '-bash']))).toEqual(['codemode', 'edit', 'read', 'write'])
    expect(sorted(resolveDefaultTools(['read', '+ls']))).toEqual(['ls', 'read'])
    expect(sorted(resolveDefaultTools([]))).toEqual([])
    expect(sorted(resolveDefaultTools(['bad name', 3]))).toEqual([])
  })

  it('encodes a selection as changes against the defaults', () => {
    expect(encodeDefaultTools(['read', 'bash', 'edit', 'write'])).toBeUndefined()
    expect(encodeDefaultTools(['read', 'edit', 'write', 'codemode'])).toEqual(['-bash', '+codemode'])
  })

  it('toggles one tool and keeps the rest, round-tripping through resolve', () => {
    const raw = withTool(['read', 'grep', 'my_ext'], 'tool_search', true)
    expect(sorted(resolveDefaultTools(raw))).toEqual(['grep', 'my_ext', 'read', 'tool_search'])
    expect(withTool(['+codemode'], 'codemode', false)).toBeUndefined()
  })
})
