/// <reference lib="dom" />
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ElementDescriptor, PageContextResult } from '@shared/browser-types'
import { FRAMEWORK_SOURCE } from './page-scripts'

const run = <T,>(src: string, ...args: unknown[]): T => new Function(`return (${src}).apply(null, arguments)`)(...args) as T

/** jsdom has no layout: point elementFromPoint at a chosen element. */
function pointAt(el: Element | null) {
  document.elementFromPoint = vi.fn(() => el) as typeof document.elementFromPoint
}

afterEach(() => {
  document.body.innerHTML = ''
  document.title = ''
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
