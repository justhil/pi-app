import { describe, expect, it } from 'vitest'
import {
  describeElement,
  formatAnnotationsForComposer,
  formatLogsForComposer,
  formatSelectionForComposer,
  isDevOrigin,
  type ElementDescriptor,
} from './browser-types'

const el = (patch: Partial<ElementDescriptor> = {}): ElementDescriptor => ({
  tag: 'button',
  classes: ['btn', 'btn-primary', 'extra'],
  selector: 'main > form > button.btn',
  rect: { x: 10, y: 20, width: 80, height: 32 },
  styles: {},
  sourceHints: [],
  ...patch,
})

describe('isDevOrigin', () => {
  it('accepts loopback, .local and private networks', () => {
    for (const url of ['http://localhost:5173/', 'http://127.0.0.1:3000', 'http://[::1]:8080/', 'http://app.localhost/', 'http://box.local', 'http://192.168.1.5:4000', 'http://10.0.0.2', 'http://172.20.1.1']) {
      expect(isDevOrigin(url), url).toBe(true)
    }
  })

  it('rejects public hosts and non-web schemes', () => {
    for (const url of ['https://github.com', 'http://172.32.0.1', 'file:///tmp/a.html', 'about:blank', 'nonsense']) {
      expect(isDevOrigin(url), url).toBe(false)
    }
  })
})

describe('describeElement', () => {
  it('summarises tag, classes, label and source', () => {
    expect(describeElement(el({ id: 'save', name: 'Save', components: ['LoginForm'], sourceHints: ['src/LoginForm.tsx:46'] }))).toBe(
      '<button#save.btn.btn-primary> "Save" (LoginForm · src/LoginForm.tsx:46)',
    )
    expect(describeElement(el({ classes: [] }))).toBe('<button>')
  })
})

describe('composer formatting', () => {
  it('numbers annotations and keeps selectors', () => {
    const text = formatAnnotationsForComposer({ title: 'Settings', url: 'http://localhost:5173/settings' }, [
      { index: 1, comment: ' too light ', element: el({ text: 'Save' }) },
      { index: 2, comment: '', area: { x: 120.4, y: 340, width: 320, height: 80 } },
    ])
    expect(text.split('\n')).toEqual([
      '[Browser annotations] Settings — http://localhost:5173/settings',
      '1. <button.btn.btn-primary> "Save" [main > form > button.btn]: too light',
      '2. Area 320×80 @ (120, 340): (no comment)',
    ])
  })

  it('formats logs and an empty log', () => {
    expect(formatLogsForComposer('http://x', [])).toBe('[Browser logs] http://x: no errors or warnings')
    expect(formatLogsForComposer('http://x', [{ at: 1, kind: 'network', level: 'error', message: 'GET /api 500', source: 'http://x/api' }])).toBe(
      '[Browser logs] http://x\n- network: GET /api 500 (http://x/api)',
    )
  })

  it('quotes selections line by line', () => {
    expect(formatSelectionForComposer('http://x', 'a\nb\n')).toBe('> a\n> b\n> — http://x\n')
  })
})
