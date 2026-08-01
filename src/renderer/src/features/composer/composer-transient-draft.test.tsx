import { useLayoutEffect, useRef } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import {
  renderRichFromSegments,
  renderRichTextFromPlain,
  serializeRichInput,
  type Segment,
} from './attachments'
import {
  clearTransientComposerDraft,
  readTransientComposerDraft,
  rememberTransientComposerDraft,
} from './composer-transient-draft'

function DraftHarness({ contextKey }: { contextKey: string }) {
  const editorRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const editor = editorRef.current
    if (!editor) return
    renderRichFromSegments(editor, readTransientComposerDraft(contextKey) ?? [])
    return () => {
      rememberTransientComposerDraft(contextKey, serializeRichInput(editor).segments)
    }
  }, [contextKey])

  const capture = () => {
    const editor = editorRef.current
    if (!editor) return
    rememberTransientComposerDraft(contextKey, serializeRichInput(editor).segments)
  }

  const clear = () => {
    const editor = editorRef.current
    if (!editor) return
    renderRichTextFromPlain(editor, '')
    capture()
  }

  return (
    <>
      <div ref={editorRef} aria-label="composer" contentEditable onInput={capture} />
      <button type="button" onClick={clear}>clear draft</button>
    </>
  )
}

const richDraft: Segment[] = [
  { type: 'text', text: 'review ' },
  {
    type: 'file',
    attachment: {
      path: 'C:/workspace/src/app.tsx',
      name: 'app.tsx',
      kind: 'code',
      chipId: 'issue-47-file',
    },
  },
  { type: 'text', text: ' before sending' },
]

function enterRichDraft(editor: HTMLElement): void {
  renderRichFromSegments(editor, richDraft)
  fireEvent.input(editor)
}

afterEach(() => {
  clearTransientComposerDraft('session:one')
  clearTransientComposerDraft('session:two')
})

describe('transient Composer draft', () => {
  it('restores rich text and attachment positions after the same context remounts', () => {
    const first = render(<DraftHarness contextKey="session:one" />)
    enterRichDraft(screen.getByLabelText('composer'))
    first.unmount()

    render(<DraftHarness contextKey="session:one" />)

    expect(serializeRichInput(screen.getByLabelText('composer')).segments).toEqual(richDraft)
  })

  it('isolates drafts when the mounted Composer switches contexts', () => {
    const view = render(<DraftHarness contextKey="session:one" />)
    enterRichDraft(screen.getByLabelText('composer'))

    view.rerender(<DraftHarness contextKey="session:two" />)
    expect(serializeRichInput(screen.getByLabelText('composer')).segments).toEqual([])

    const secondDraft: Segment[] = [{ type: 'text', text: 'session two' }]
    renderRichFromSegments(screen.getByLabelText('composer'), secondDraft)
    fireEvent.input(screen.getByLabelText('composer'))

    view.rerender(<DraftHarness contextKey="session:one" />)
    expect(serializeRichInput(screen.getByLabelText('composer')).segments).toEqual(richDraft)

    view.rerender(<DraftHarness contextKey="session:two" />)
    expect(serializeRichInput(screen.getByLabelText('composer')).segments).toEqual(secondDraft)
  })

  it('does not restore after normal send or clear empties the draft', () => {
    const first = render(<DraftHarness contextKey="session:one" />)
    enterRichDraft(screen.getByLabelText('composer'))
    fireEvent.click(screen.getByRole('button', { name: 'clear draft' }))
    first.unmount()

    render(<DraftHarness contextKey="session:one" />)

    expect(serializeRichInput(screen.getByLabelText('composer')).segments).toEqual([])
  })
})
