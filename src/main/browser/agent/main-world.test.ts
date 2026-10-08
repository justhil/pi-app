// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { mainWorldEval } from './main-world'

const run = async (fn: string, selector: string | null) => (await (0, eval)(mainWorldEval(fn, selector))) as { value?: unknown; __error?: { error: string } }

describe('mainWorldEval', () => {
  it('passes the target element and returns JSON-safe values (cycles, functions, nodes)', async () => {
    document.body.innerHTML = '<p id="x">hi</p>'
    const res = await run('(el) => { const o = { el, f: function go() {}, n: 1 }; o.self = o; return o }', '#x')
    expect(res.value).toEqual({ el: '[p]', f: '[Function go]', n: 1, self: '[Circular]' })
  })

  it('reports a missing target as stale', async () => {
    document.body.innerHTML = ''
    expect((await run('(el) => el', '#gone')).__error?.error).toBe('stale_ref')
  })

  it('finds React props on the element or an ancestor', async () => {
    document.body.innerHTML = '<div id="w"><span id="s">pick</span></div>'
    const w = document.getElementById('w') as HTMLElement & Record<string, unknown>
    w.__reactProps$abc = { value: 'a', onChange: () => undefined }
    const res = await run('(el) => { const c = piComponent(el); return { kind: c.kind, value: c.props.value } }', '#s')
    expect(res.value).toEqual({ kind: 'react', value: 'a' })
  })

  it('walks a Vue 3 vnode tree from the mount container (prod builds)', async () => {
    document.body.innerHTML = '<div id="app"><div class="select"><input id="i"></div></div>'
    const host = document.querySelector('.select')!
    const comp = { props: { modelValue: 'x' }, setupState: {}, emit: () => undefined, subTree: { el: host, children: [] } }
    ;(document.getElementById('app') as HTMLElement & { _vnode: unknown })._vnode = { component: { subTree: { el: document.getElementById('app'), children: [{ component: comp }] } } }
    const res = await run('(el) => piComponent(el).props.modelValue', '#i')
    expect(res.value).toBe('x')
  })
})
