import { describe, expect, it } from 'vitest'
import { RenderNodeSchema } from '@shared/remote'
import { PREVIEW_LIMITS, buildRenderNode, diffStats, toolCategory } from '../render-node'

describe('render nodes', () => {
  it('bash keeps the output tail and flags truncation', () => {
    const long = 'x'.repeat(PREVIEW_LIMITS.bash + 100) + 'END'
    const n = buildRenderNode({ toolName: 'bash', args: { command: 'npm test\n--watch' }, output: long, phase: 'end' })
    expect(RenderNodeSchema.safeParse(n).success).toBe(true)
    expect(n).toMatchObject({ template: 'bash', title: 'npm test', status: 'ok', detail: true })
    expect(n.preview!.endsWith('END')).toBe(true)
    expect(n.preview!.length).toBe(PREVIEW_LIMITS.bash)
  })

  it('edit counts unified diff lines, ignoring file headers', () => {
    const diff = '--- a/x\n+++ b/x\n@@ -1,2 +1,3 @@\n a\n-b\n+b2\n+c'
    expect(diffStats('edit', { path: 'x' }, { diff })).toMatchObject({ add: 2, del: 1 })
    const n = buildRenderNode({ toolName: 'edit', args: { path: 'x' }, details: { diff }, phase: 'end' })
    expect(n).toMatchObject({ template: 'edit', fields: { path: 'x', add: 2, del: 1 }, preview: diff })
  })

  it('write counts content lines as additions', () => {
    expect(diffStats('write', { path: 'n.ts', content: 'a\nb\nc\n' }, undefined)).toEqual({ add: 3, del: 0 })
  })

  it('running and failed status', () => {
    expect(buildRenderNode({ toolName: 'read', args: { path: 'a' }, phase: 'start' }).status).toBe('running')
    expect(buildRenderNode({ toolName: 'read', args: { path: 'a' }, phase: 'end', isError: true }).status).toBe('error')
  })

  it('adapter tools use the toolCard template and JSONPath fields', () => {
    const n = buildRenderNode(
      { toolName: 'web_search', args: { query: 'pi agent' }, details: { results: [{ title: 'a' }] }, output: 'found 1', phase: 'end' },
      { template: 'list', icon: 'search', fields: { items: '$.details.results', title: '$.args.query' } },
    )
    expect(n).toMatchObject({ template: 'list', icon: 'search', title: 'pi agent', fields: { items: [{ title: 'a' }] }, preview: 'found 1' })
  })

  it('unknown tools without an adapter fall back to default', () => {
    const n = buildRenderNode({ toolName: 'mystery', args: { a: 1 }, output: 'done', phase: 'end' })
    expect(n).toMatchObject({ template: 'default', title: 'mystery', fallbackText: 'mystery' })
  })

  it('huge adapter fields are reduced to scalars', () => {
    const n = buildRenderNode(
      { toolName: 't', details: { blob: 'y'.repeat(40_000), n: 3 }, phase: 'end' },
      { template: 'kv', fields: { blob: '$.details.blob', n: '$.details.n' } },
    )
    expect(n.detail).toBe(true)
    expect((n.fields.blob as string).length).toBe(1024)
    expect(n.fields.n).toBe(3)
  })

  it('categories follow built-in tool kinds', () => {
    expect(['bash', 'read', 'edit', 'write', 'grep', 'find', 'ls', 'x'].map((t) => toolCategory(t))).toEqual(['run', 'read', 'edit', 'write', 'search', 'search', 'search', 'other'])
    expect(toolCategory('hashline_edit', { template: 'hashline' })).toBe('edit')
  })
})
