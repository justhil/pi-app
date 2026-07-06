import { describe, expect, it } from 'vitest'
import { toolCallDetailFromPi } from './tool-call-detail'

describe('toolCallDetailFromPi', () => {
  it('maps bash', () => {
    const d = toolCallDetailFromPi('bash', { command: 'ls' }, 'out')
    expect(d).toEqual({ type: 'bash', command: 'ls', output: 'out' })
  })

  it('maps edit with edits array', () => {
    const d = toolCallDetailFromPi('edit', { path: 'a.ts', edits: [{ oldText: 'x', newText: 'y' }] }, '')
    expect(d.type).toBe('edit')
    if (d.type === 'edit') {
      expect(d.path).toBe('a.ts')
      expect(d.edits).toHaveLength(1)
    }
  })
})