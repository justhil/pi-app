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

  it('shows only a modal dialog when it covers the page', () => {
    document.body.innerHTML = '<button id="under">Buy</button><div role="dialog" aria-modal="true" aria-label="Sign in"><button id="ok">OK</button></div>'
    boxOf = (el) => (el.tagName === 'BUTTON' ? { x: 10, y: 10, width: 80, height: 30 } : { x: 0, y: 0, width: 400, height: 300 })
    pointAt(document.getElementById('ok'))
    const s = snap()
    expect(s.yaml).toMatch(/button "OK" \[ref=e\d+\]/)
    expect(s.yaml).not.toMatch(/Buy/)
    expect(s.modal).toEqual({ description: 'dialog "Sign in"', behind: 1 })
    expect(snap({ target: 'body' }).yaml).toMatch(/Buy/)
  })

  it('finds an unlabelled overlay by position, size and center hit', () => {
    document.body.innerHTML = '<button>Buy</button><div id="ov" style="position: fixed"><p>Subscribe?</p><button id="no">No thanks</button></div>'
    const ov = document.getElementById('ov')!
    boxOf = (el) => (el === ov ? { x: 200, y: 150, width: 600, height: 400 } : { x: 10, y: 10, width: 80, height: 30 })
    pointAt(document.getElementById('no'))
    expect(rt.findModal()).toBe(ov)
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

describe('dropFiles', () => {
  it('dispatches drag events carrying the files on the drop zone', () => {
    if (typeof DataTransfer === 'undefined' || typeof DragEvent === 'undefined') return // jsdom lacks drag-and-drop
    document.body.innerHTML = '<div id="zone">Drop here</div>'
    const seen: string[] = []
    const zone = document.getElementById('zone')!
    for (const t of ['dragenter', 'dragover', 'drop']) zone.addEventListener(t, (e) => seen.push(`${t}:${(e as DragEvent).dataTransfer?.files.length}`))
    expect(rt.dropFiles('#zone', [{ name: 'a.txt', type: 'text/plain', base64: btoa('hi') }])).toEqual({ count: 1 })
    expect(seen).toEqual(['dragenter:1', 'dragover:1', 'drop:1'])
  })
})

describe('selectorOf', () => {
  it('gives a selector that finds the same element', () => {
    document.body.innerHTML = '<ul><li><button>A</button></li><li><button>B</button></li></ul>'
    const ref = refOf(snap().yaml, /button "B"/)
    const res = rt.selectorOf(ref) as { selector: string }
    expect(document.querySelector(res.selector)).toBe(document.querySelectorAll('button')[1])
  })
})

describe('inferred names', () => {
  it('names unlabelled controls from tooltips, icon classes and link paths', () => {
    document.body.innerHTML = `
      <button data-tooltip="Delete row"><svg></svg></button>
      <button><i class="fa fa-magnifying-glass"></i></button>
      <a href="/account/settings"><svg></svg></a>
      <button>Labelled</button>`
    const y = snap().yaml
    expect(y).toMatch(/button "~Delete row" \[ref=e\d+\]/)
    expect(y).toMatch(/button "~magnifying glass" \[ref=e\d+\]/)
    expect(y).toMatch(/link "~settings" \[ref=e\d+\]/)
    expect(y).toMatch(/button "Labelled" \[ref=e\d+\]/)
  })
})

describe('has-submenu', () => {
  it('marks aria-haspopup and nav entries next to a hidden block of links, not plain links', () => {
    document.body.innerHTML = `
      <nav><ul>
        <li><a href="/p">Products</a><ul style="display:none"><li><a href="/p/a">A</a></li><li><a href="/p/b">B</a></li></ul></li>
        <li><a href="/about">About</a></li>
      </ul></nav>
      <button aria-haspopup="menu">More</button>`
    const s = snap()
    expect(s.yaml).toMatch(/link "Products" \[ref=e\d+\] \[has-submenu\]/)
    expect(s.yaml).toMatch(/button "More" \[ref=e\d+\] \[has-submenu\]/)
    expect(s.yaml).not.toMatch(/link "About" \[ref=e\d+\] \[has-submenu\]/)
  })
})

describe('textView', () => {
  it('reads text with controls inline by ref, skipping hidden content', () => {
    document.body.innerHTML = '<main><h2>Order</h2><p>Pick a size.</p><ul><li>Small</li><li>Large</li></ul><label>Email <input></label><button>Pay now</button><p hidden>secret</p></main>'
    const t = rt.textView() as { text: string; truncated: boolean }
    expect(t.text).toMatch(/## Order\nPick a size\.\n- Small\n- Large/)
    expect(t.text).toMatch(/\[textbox "Email" ref=e\d+\]/)
    expect(t.text).toMatch(/\[button "Pay now" ref=e\d+\]/)
    expect(t.text).not.toMatch(/secret/)
    const ref = /\[button "Pay now" ref=(e\d+)\]/.exec(t.text)![1]
    expect(rt.resolveElement(ref)).toBe(document.querySelector('button'))
  })

  it('scopes to a target and cuts at maxChars', () => {
    document.body.innerHTML = `<section id="a"><p>${'word '.repeat(400)}</p></section><section id="b"><p>other</p></section>`
    const t = rt.textView({ target: '#a', maxChars: 300 }) as { text: string; truncated: boolean; chars: number }
    expect(t.truncated).toBe(true)
    expect(t.text.length).toBeLessThanOrEqual(300)
    expect(t.text).not.toMatch(/other/)
  })
})

describe('transients', () => {
  const tick = () => new Promise((r) => setTimeout(r, 0))

  it('reports text that flashed and is gone, not text that stays or was there before', async () => {
    document.body.innerHTML = '<main><p>Existing paragraph text</p></main>'
    rt.transients.start()
    const toast = document.createElement('div')
    toast.textContent = 'Saved successfully'
    document.body.append(toast)
    const stays = document.createElement('p')
    stays.textContent = 'New permanent row'
    document.querySelector('main')!.append(stays)
    await tick()
    toast.remove()
    expect(rt.transients.take()).toEqual(['Saved successfully'])
  })

  it('reports live-region announcements even while they stay', async () => {
    document.body.innerHTML = '<div role="status"></div>'
    rt.transients.start()
    document.querySelector('[role=status]')!.textContent = 'Code is invalid'
    expect(rt.transients.take()).toEqual(['Code is invalid'])
  })

  it('returns nothing without a start (new document)', () => {
    expect(rt.transients.take()).toEqual([])
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
