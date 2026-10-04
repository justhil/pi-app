import { describe, expect, it } from 'vitest'
// pi's own tool_search ranking (not in the package's public exports, so imported by path).
import { Bm25Ranker, createToolSearchDocument } from '../../node_modules/@earendil-works/pi-coding-agent/dist/extensions/tool-search/tool.js'
import { BROWSER_DEFERRED_TOOLS, BROWSER_NAMESPACE, BROWSER_TOOL_DEFS, leanSchema } from '@shared/browser-tools'

// What tool_search ranks: the deferred browser tools, as the worker registers them.
const documents = BROWSER_TOOL_DEFS.filter((d) => BROWSER_DEFERRED_TOOLS.includes(d.name)).map((d) =>
  createToolSearchDocument({ name: d.name, description: d.description, parameters: leanSchema(d.parameters) }, BROWSER_NAMESPACE),
)
const search = (query: string, limit = 8) => new Bm25Ranker().rank(query, documents, limit).map((m: { name: string }) => m.name)

describe('browser tools through tool_search', () => {
  it('loads exactly the tools named, when limit matches the count', () => {
    expect(search('browser_wait_for browser_tabs', 2).sort()).toEqual(['browser_tabs', 'browser_wait_for'])
    expect(search('browser_file_upload', 1)).toEqual(['browser_file_upload'])
    for (const name of BROWSER_DEFERRED_TOOLS) expect(search(name, 1)).toEqual([name])
  })

  it('finds the right tool from plain wording', () => {
    expect(search('wait for text to appear')[0]).toBe('browser_wait_for')
    expect(search('switch to another tab')[0]).toBe('browser_tabs')
    expect(search('upload a file')[0]).toBe('browser_file_upload')
    expect(search('press Enter key')[0]).toBe('browser_press_key')
    expect(search('fill several form fields')[0]).toBe('browser_fill_form')
    expect(search('accept the confirm dialog')[0]).toBe('browser_handle_dialog')
    expect(search('save the page as pdf')[0]).toBe('browser_pdf_save')
    expect(search('go back')[0]).toBe('browser_navigate_back')
  })

  it('reaches every deferred tool from a broad query with a large limit', () => {
    expect(search('browser', 30).sort()).toEqual([...BROWSER_DEFERRED_TOOLS].sort())
  })
})
