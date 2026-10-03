/// <reference lib="dom" />
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ElementDescriptor, PageContextResult } from '@shared/browser-types'
import { FRAMEWORK_SOURCE, INSPECT_AT_POINT, PAGE_CONTEXT } from './page-scripts'

const run = <T,>(src: string, ...args: unknown[]): T => new Function(`return (${src}).apply(null, arguments)`)(...args) as T

/** jsdom has no layout: point elementFromPoint at a chosen element. */
function pointAt(el: Element | null) {
  document.elementFromPoint = vi.fn(() => el) as typeof document.elementFromPoint
}

afterEach(() => {
  document.body.innerHTML = ''
  document.title = ''
})

describe('INSPECT_AT_POINT', () => {
  it('describes the element and builds a unique selector without touching the DOM', () => {
    document.body.innerHTML = `
      <main><form>
        <button class="btn btn-primary">Cancel</button>
        <button class="btn btn-primary" aria-label="Save changes">Save</button>
      </form></main>`
    const target = document.querySelectorAll('button')[1]
    pointAt(target)
    const before = document.body.innerHTML
    const d = run<ElementDescriptor>(INSPECT_AT_POINT, 5, 5)
    expect(document.body.innerHTML).toBe(before)
    expect(d.tag).toBe('button')
    expect(d.role).toBe('button')
    expect(d.name).toBe('Save changes')
    expect(d.text).toBe('Save')
    expect(d.classes).toEqual(['btn', 'btn-primary'])
    expect(document.querySelectorAll(d.selector)).toHaveLength(1)
    expect(document.querySelector(d.selector)).toBe(target)
  })

  it('prefers a unique id and collects source attributes from ancestors', () => {
    document.body.innerHTML = `<section data-v-inspector="src/App.vue:12:3"><div data-insp-path="src/Card.tsx:8"><a id="go" href="/x">${'long text '.repeat(20)}</a></div></section>`
    pointAt(document.getElementById('go'))
    const d = run<ElementDescriptor>(INSPECT_AT_POINT, 1, 1)
    expect(d.selector).toBe('#go')
    expect(d.role).toBe('link')
    expect(d.text?.length).toBeLessThanOrEqual(80)
    expect(d.sourceHints).toEqual(['src/Card.tsx:8', 'src/App.vue:12:3'])
  })

  it('returns null when nothing is under the point', () => {
    pointAt(null)
    expect(run(INSPECT_AT_POINT, 0, 0)).toBeNull()
  })
})

describe('PAGE_CONTEXT', () => {
  it('reads main content, truncates and reports the selection', () => {
    document.title = 'Docs'
    document.body.innerHTML = `<nav>menu</nav><main><h1>Title</h1><p>${'x'.repeat(50)}</p></main>`
    const r = run<PageContextResult>(PAGE_CONTEXT, 20)
    expect(r.title).toBe('Docs')
    expect(r.text).toHaveLength(20)
    expect(r.text.startsWith('Title')).toBe(true)
    expect(r.text).not.toContain('menu')
    expect(r.truncated).toBe(true)
    expect(r.selection).toBe('')
  })
})

describe('FRAMEWORK_SOURCE', () => {
  it('walks a React fiber chain for component names and debug sources', () => {
    document.body.innerHTML = '<button>Save</button>'
    const button = document.querySelector('button')!
    function LoginForm() {}
    const parent = { type: LoginForm, _debugSource: { fileName: '/home/me/app/src/components/LoginForm.tsx', lineNumber: 46 }, return: null }
    Object.assign(button, { __reactFiber$abc: { type: 'button', return: parent } })
    pointAt(button)
    expect(run(FRAMEWORK_SOURCE, 1, 1)).toEqual({ components: ['LoginForm'], sourceHints: ['src/components/LoginForm.tsx:46'] })
  })

  it('reads Vue component files', () => {
    document.body.innerHTML = '<div><span>hi</span></div>'
    const div = document.querySelector('div')!
    Object.assign(div, { __vueParentComponent: { type: { __name: 'Card', __file: '/w/proj/src/Card.vue' }, parent: null } })
    pointAt(document.querySelector('span'))
    expect(run(FRAMEWORK_SOURCE, 1, 1)).toEqual({ components: ['Card'], sourceHints: ['src/Card.vue'] })
  })
})
