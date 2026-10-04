/// <reference lib="dom" />
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as rt from './index'

type Snap = Exclude<ReturnType<typeof rt.snapshot>, { error: string }>
const snap = (opts?: Parameters<typeof rt.snapshot>[0]) => {
  const s = rt.snapshot(opts)
  if ('error' in s) throw new Error(s.message)
  return s as Snap
}
const refOf = (yaml: string, line: RegExp) => {
  const m = yaml.split('\n').find((l) => line.test(l))?.match(/\[ref=(e\d+)\]/)
  if (!m) throw new Error(`no ref for ${line} in\n${yaml}`)
  return m[1]
}

/** jsdom has no layout: point elementFromPoint at a chosen element. */
function pointAt(el: Element | null) {
  document.elementFromPoint = vi.fn(() => el) as typeof document.elementFromPoint
}

// jsdom lacks Element.checkVisibility (Playwright's visibility check uses it).
if (!('checkVisibility' in Element.prototype)) {
  Object.defineProperty(Element.prototype, 'checkVisibility', {
    configurable: true,
    value(this: Element) {
      if (getComputedStyle(this).display === 'none') return false
      for (let e = this.parentElement; e; e = e.parentElement) if (getComputedStyle(e).display === 'none') return false
      return true
    },
  })
}

// jsdom has no layout. Give every element a box above the viewport: visible to Playwright's
// checks (refs need a non-empty box) but outside the occlusion / below-the-fold post-pass.
// Individual tests override `boxOf` to place elements.
let boxOf: (el: Element) => { x: number; y: number; width: number; height: number } = () => ({ x: 0, y: -500, width: 100, height: 20 })
Element.prototype.getBoundingClientRect = function (this: Element) {
  const b = boxOf(this)
  return { ...b, left: b.x, top: b.y, right: b.x + b.width, bottom: b.y + b.height, toJSON: () => b } as DOMRect
}

afterEach(() => {
  boxOf = () => ({ x: 0, y: -500, width: 100, height: 20 })
  document.body.innerHTML = ''
  document.title = ''
})

describe('inspectAtPoint', () => {
  it('describes the element and builds a unique selector without touching the DOM', () => {
    document.body.innerHTML = `
      <main><form>
        <button class="btn btn-primary">Cancel</button>
        <button class="btn btn-primary" aria-label="Save changes">Save</button>
      </form></main>`
    const target = document.querySelectorAll('button')[1]
    pointAt(target)
    const before = document.body.innerHTML
    const d = rt.inspectAtPoint(5, 5)!
    expect(document.body.innerHTML).toBe(before)
    expect(d.tag).toBe('button')
    expect(d.role).toBe('button')
    expect(d.name).toBe('Save changes')
    expect(d.text).toBe('Save')
    expect(d.classes).toEqual(['btn', 'btn-primary'])
    expect(document.querySelector(d.selector)).toBe(target)
  })

  it('prefers a unique id and collects source attributes from ancestors', () => {
    document.body.innerHTML = `<section data-v-inspector="src/App.vue:12:3"><div data-insp-path="src/Card.tsx:8"><a id="go" href="/x">${'long text '.repeat(20)}</a></div></section>`
    pointAt(document.getElementById('go'))
    const d = rt.inspectAtPoint(1, 1)!
    expect(d.selector).toBe('#go')
    expect(d.role).toBe('link')
    expect(d.text?.length).toBeLessThanOrEqual(80)
    expect(d.sourceHints).toEqual(['src/Card.tsx:8', 'src/App.vue:12:3'])
  })

  it('returns null when nothing is under the point', () => {
    pointAt(null)
    expect(rt.inspectAtPoint(0, 0)).toBeNull()
  })
})

describe('pageContext', () => {
  it('reads main content, truncates and reports the selection', () => {
    document.title = 'Docs'
    document.body.innerHTML = `<nav>menu</nav><main><h1>Title</h1><p>${'x'.repeat(50)}</p></main>`
    const r = rt.pageContext(20)
    expect(r.title).toBe('Docs')
    expect(r.text).toHaveLength(20)
    expect(r.text.startsWith('Title')).toBe(true)
    expect(r.text).not.toContain('menu')
    expect(r.truncated).toBe(true)
  })
})

describe('snapshot', () => {
  const form = `<main><h1>Profile</h1>
    <label for="name">Name</label><input id="name">
    <label><input type="checkbox" id="news"> Newsletter</label>
    <select id="plan" aria-label="Plan"><option value="f">Free</option><option value="p">Pro</option></select>
    <button id="save">Save</button><button>Save</button>
    <div hidden><button>Secret</button></div>
  </main>`

  it('renders Playwright-style YAML with refs, skipping hidden content', () => {
    document.body.innerHTML = form
    const s = snap()
    expect(s.yaml).toMatch(/- heading "Profile" \[level=1\]/)
    expect(s.yaml).toMatch(/- textbox "Name" \[ref=e\d+\]/)
    expect(s.yaml).toMatch(/- checkbox "Newsletter" \[ref=e\d+\]/)
    expect(s.yaml).toMatch(/- combobox "Plan" \[ref=e\d+\]/)
    expect(s.yaml).not.toContain('Secret')
    expect(s.refCount).toBeGreaterThanOrEqual(5)
  })

  it('keeps refs stable across snapshots', () => {
    document.body.innerHTML = form
    const a = refOf(snap().yaml, /textbox "Name"/)
    document.getElementById('name')!.insertAdjacentHTML('beforebegin', '<button>New</button>')
    expect(refOf(snap().yaml, /textbox "Name"/)).toBe(a)
  })

  it('scopes to a target and truncates', () => {
    document.body.innerHTML = `<nav><a href="/a">Home</a></nav><main>${'<p>para</p>'.repeat(400)}</main>`
    const ref = refOf(snap().yaml, /link "Home"/)
    expect(snap({ target: ref }).yaml).not.toContain('para')
    const long = snap({ maxChars: 300 })
    expect(long.truncated).toBe(true)
    expect(long.yaml.length).toBeLessThanOrEqual(300)
  })
})

describe('snapshot post-pass', () => {
  it('drops refs of elements covered by an overlay and counts them', () => {
    document.body.innerHTML = '<button id="under">Buy</button><div id="modal" role="dialog"><button id="ok">OK</button></div>'
    const ok = document.getElementById('ok')!
    boxOf = (el) => (el.tagName === 'BUTTON' ? { x: 10, y: 10, width: 80, height: 30 } : { x: 0, y: 0, width: 400, height: 300 })
    pointAt(ok)
    const s = snap()
    expect(s.yaml).toMatch(/button "OK" \[ref=e\d+\]/)
    expect(s.yaml).toMatch(/button "Buy"(?! \[ref)/)
    expect(s.covered).toBe(1)
  })

  it('counts interactive elements below the fold', () => {
    document.body.innerHTML = '<a href="/1">One</a><a href="/2">Two</a><a href="/3">Three</a>'
    const links = [...document.querySelectorAll('a')]
    boxOf = (el) => ({ x: 0, y: el === links[0] ? 10 : innerHeight * (links.indexOf(el as HTMLAnchorElement) + 1), width: 50, height: 20 })
    pointAt(null)
    document.elementFromPoint = vi.fn(() => links[0]) as typeof document.elementFromPoint
    const s = snap()
    expect(s.belowFold).toEqual({ count: 2, screens: 3 })
    expect(s.covered).toBe(0)
  })
})

describe('resolveElement', () => {
  it('resolves refs and reports stale ones', () => {
    document.body.innerHTML = '<button id="a">Go</button>'
    const ref = refOf(snap().yaml, /button "Go"/)
    expect(rt.resolveElement(ref)).toBe(document.getElementById('a'))
    expect(rt.resolveElement('e999999')).toMatchObject({ error: 'stale_ref' })
  })

  it('relocates a re-rendered element by role, name and position', () => {
    document.body.innerHTML = '<button>Go</button><button>Go</button>'
    const ref = [...snap().yaml.matchAll(/button "Go" \[ref=(e\d+)\]/g)][1][1]
    document.body.innerHTML = '<button>Go</button><button id="second">Go</button>'
    expect(rt.resolveElement(ref)).toBe(document.getElementById('second'))
    document.body.innerHTML = '<p>gone</p>'
    expect(rt.resolveElement(ref)).toMatchObject({ error: 'stale_ref' })
  })

  it('understands Playwright locators and requires a unique match', () => {
    document.body.innerHTML = `<label for="e">Email</label><input id="e" placeholder="you@x.com">
      <button data-testid="go">Send</button><button>Cancel</button><p>Hello <b>world</b></p>`
    expect(rt.resolveElement(`getByRole('button', { name: 'Send' })`)).toBe(document.querySelector('[data-testid=go]'))
    expect(rt.resolveElement(`getByLabel('Email')`)).toBe(document.getElementById('e'))
    expect(rt.resolveElement(`getByPlaceholder("you@x.com")`)).toBe(document.getElementById('e'))
    expect(rt.resolveElement(`getByTestId('go')`)).toBe(document.querySelector('[data-testid=go]'))
    expect(rt.resolveElement(`getByText('world', { exact: true })`)).toBe(document.querySelector('b'))
    expect(rt.resolveElement('role=button[name="Cancel"]')).toBe(document.querySelectorAll('button')[1])
    expect(rt.resolveElement('#e')).toBe(document.getElementById('e'))
    expect(rt.resolveElement(`getByRole('button')`)).toMatchObject({ error: 'ambiguous' })
    expect(rt.resolveElement('.missing')).toMatchObject({ error: 'not_found' })
    expect(rt.resolveElement('a[')).toMatchObject({ error: 'invalid_target' })
  })
})

describe('inputs', () => {
  it('selects the whole value, or puts the caret at the end to append', () => {
    document.body.innerHTML = '<input id="i" value="old text">'
    const input = document.getElementById('i') as HTMLInputElement
    expect(rt.prepareInput('#i')).toEqual({ kind: 'value' })
    expect([input.selectionStart, input.selectionEnd]).toEqual([0, 8])
    rt.prepareInput('#i', { keep: true })
    expect([input.selectionStart, input.selectionEnd]).toEqual([8, 8])
  })

  it('selects rich editor content with the Selection API', () => {
    document.body.innerHTML = '<div id="ed" contenteditable="true"><p>one</p><p>two</p></div>'
    // jsdom lacks isContentEditable.
    Object.defineProperty(HTMLElement.prototype, 'isContentEditable', { configurable: true, get() { return this.closest('[contenteditable="true"]') !== null } })
    try {
      expect(rt.prepareInput('#ed')).toEqual({ kind: 'contenteditable' })
      expect(String(getSelection())).toBe('onetwo')
    } finally {
      delete (HTMLElement.prototype as { isContentEditable?: boolean }).isContentEditable
    }
  })

  it('selects options by value or label and lists choices when missing', () => {
    document.body.innerHTML = '<select id="s"><option value="f">Free</option><option value="p">Pro</option></select>'
    const changes: string[] = []
    document.getElementById('s')!.addEventListener('change', (e) => changes.push((e.target as HTMLSelectElement).value))
    expect(rt.selectOptions('#s', ['Pro'])).toEqual({ selected: ['p'] })
    expect(changes).toEqual(['p'])
    expect(rt.selectOptions('#s', ['Gold'])).toMatchObject({ error: 'not_found', message: expect.stringContaining('Free, Pro') })
  })

  it('sets slider values and recognises file inputs', () => {
    document.body.innerHTML = '<input id="r" type="range" min="0" max="10"><input id="f" type="file"><label for="f" id="l">Pick</label>'
    expect(rt.setRangeValue('#r', '7')).toEqual({ value: '7' })
    expect(rt.isFileTarget('#f')).toBe(true)
    expect(rt.isFileTarget('#l')).toBe(true)
    expect(rt.isFileTarget('#r')).toBe(false)
  })
})

describe('find', () => {
  it('returns matching lines under their ancestors', () => {
    document.body.innerHTML = '<nav><a href="/a">Docs</a></nav><main><h2>Billing</h2><ul><li><a href="/p">Pay invoice</a></li></ul></main>'
    const r = rt.find({ text: 'invoice' })
    if ('error' in r) throw new Error(r.message)
    expect(r.count).toBe(1)
    expect(r.matches).toMatch(/- main \[ref=e\d+\]:[\s\S]*- link "Pay invoice"/)
    expect(r.matches).not.toContain('Docs')
    expect(rt.find({ regex: '/^nothing$/' })).toMatchObject({ count: 0 })
    expect(rt.find({ regex: '/(/' })).toMatchObject({ error: 'invalid_target' })
  })
})

describe('quiet', () => {
  it('waits until the DOM stops changing', async () => {
    document.body.innerHTML = '<p id="out"></p>'
    setTimeout(() => (document.getElementById('out')!.textContent = 'loaded'), 100)
    const r = await rt.quiet({ idleMs: 150, timeoutMs: 2000 })
    expect(r.settled).toBe(true)
    expect(r.waitedMs).toBeGreaterThanOrEqual(240)
    expect(document.getElementById('out')!.textContent).toBe('loaded')
  })
  it('gives up at the timeout on a page that never settles', async () => {
    document.body.innerHTML = '<p id="tick"></p>'
    const timer = setInterval(() => (document.getElementById('tick')!.textContent = String(Date.now())), 30)
    const r = await rt.quiet({ idleMs: 100, timeoutMs: 300 })
    clearInterval(timer)
    expect(r.settled).toBe(false)
  })
})
