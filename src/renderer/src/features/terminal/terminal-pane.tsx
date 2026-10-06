import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { SearchAddon } from '@xterm/addon-search'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { WebglAddon } from '@xterm/addon-webgl'
import '@xterm/xterm/css/xterm.css'
import { ipcClient } from '@renderer/lib/ipc-client'
import { cn } from '@renderer/lib/utils'
import { attachWriter, resizePty, shellPath, writeToPty } from './terminal-bridge'
import { terminalActions, useTerminalStore, type TerminalPaneState } from './terminal-store'
import { TERMINAL_FONT, terminalTheme } from './terminal-theme'

type Instance = { term: Terminal; host: HTMLDivElement; fit: FitAddon; search: SearchAddon; dispose: () => void }

/**
 * xterm instances outlive their React pane: a terminal cannot be re-opened into a new element,
 * so each pty's terminal lives in its own host div that panes move in and out of the DOM.
 */
const instances = new Map<string, Instance>()

const isMac = () => window.piDesktop?.platform === 'darwin'

function createInstance(pane: TerminalPaneState): Instance {
  const host = document.createElement('div')
  host.className = 'terminal-host h-full w-full'
  const term = new Terminal({
    fontFamily: TERMINAL_FONT,
    fontSize: 12.5,
    lineHeight: 1.25,
    letterSpacing: 0,
    cursorBlink: true,
    cursorStyle: 'bar',
    cursorWidth: 2,
    scrollback: 10000,
    allowProposedApi: true,
    macOptionIsMeta: true,
    rightClickSelectsWord: true,
    smoothScrollDuration: 80,
    theme: terminalTheme(),
  })
  const fit = new FitAddon()
  const search = new SearchAddon()
  term.loadAddon(fit)
  term.loadAddon(search)
  term.loadAddon(new Unicode11Addon())
  term.unicode.activeVersion = '11'
  term.loadAddon(new WebLinksAddon((_e, uri) => window.open(uri)))
  term.open(host)
  // E2E reads the rows from the DOM, which the WebGL renderer does not produce.
  if (!(window.piDesktop as { e2e?: boolean } | undefined)?.e2e) try {
    const gl = new WebglAddon()
    // GPU context loss (driver reset, sleep): fall back to the DOM renderer instead of a blank pane.
    gl.onContextLoss(() => gl.dispose())
    term.loadAddon(gl)
  } catch {
    /* no WebGL2: the DOM renderer still works */
  }

  term.attachCustomKeyEventHandler((e) => {
    if (e.type !== 'keydown') return true
    const mod = isMac() ? e.metaKey : e.ctrlKey && e.shiftKey
    // Ctrl+` toggles the drawer: let the window shortcut have it.
    if (e.ctrlKey && (e.key === '`' || e.code === 'Backquote')) return false
    if (mod && e.key.toLowerCase() === 'c' && term.hasSelection()) {
      void navigator.clipboard.writeText(term.getSelection())
      return false
    }
    // Windows-terminal habit: Ctrl+C with a selection copies instead of interrupting.
    if (!isMac() && e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === 'c' && term.hasSelection()) {
      void navigator.clipboard.writeText(term.getSelection())
      term.clearSelection()
      return false
    }
    if (mod && e.key.toLowerCase() === 'v') {
      void navigator.clipboard.readText().then((t) => t && term.paste(t))
      return false
    }
    if (mod && e.key.toLowerCase() === 'f') {
      window.dispatchEvent(new CustomEvent('pi-desktop:terminal-search', { detail: pane.ptyId }))
      return false
    }
    return true
  })

  const offInput = term.onData((d) => writeToPty(pane.ptyId, d))
  const offResize = term.onResize(({ cols, rows }) => resizePty(pane.ptyId, cols, rows))
  const offOutput = attachWriter(pane.ptyId, (d) => term.write(d))

  // Images on the clipboard: save as a temp file and type its path (CLI agents read image paths).
  const onPaste = (e: ClipboardEvent) => {
    const file = [...(e.clipboardData?.files ?? [])].find((f) => f.type.startsWith('image/'))
    if (!file) return
    e.preventDefault()
    e.stopPropagation()
    const reader = new FileReader()
    reader.onload = () => {
      const m = /^data:(image\/[a-z]+);base64,(.*)$/i.exec(String(reader.result))
      if (!m) return
      void ipcClient.invoke('clipboard.writeTempImage', { data: m[2], mimeType: m[1] }).then((r: { path?: string }) => {
        if (r?.path) term.paste(`${shellPath(r.path, pane.profile.kind)} `)
      })
    }
    reader.readAsDataURL(file)
  }
  host.addEventListener('paste', onPaste, true)

  // Follow light / dark switches.
  const themeObserver = new MutationObserver(() => {
    term.options.theme = terminalTheme()
  })
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style'] })

  return {
    term,
    host,
    fit,
    search,
    dispose: () => {
      themeObserver.disconnect()
      host.removeEventListener('paste', onPaste, true)
      offInput.dispose()
      offResize.dispose()
      offOutput()
      term.dispose()
    },
  }
}

export function disposeTerminalInstance(ptyId: string): void {
  instances.get(ptyId)?.dispose()
  instances.delete(ptyId)
}

export function terminalSelection(ptyId: string): string {
  return instances.get(ptyId)?.term.getSelection() ?? ''
}

export function onTerminalSelection(ptyId: string, cb: (has: boolean) => void): () => void {
  const inst = instances.get(ptyId)
  if (!inst) return () => {}
  const d = inst.term.onSelectionChange(() => cb(inst.term.hasSelection()))
  return () => d.dispose()
}

export function TerminalPane({ tabId, index, pane, active, visible }: { tabId: string; index: number; pane: TerminalPaneState; active: boolean; visible: boolean }) {
  const { t } = useTranslation()
  const ref = useRef<HTMLDivElement>(null)
  const [searching, setSearching] = useState(false)
  const [query, setQuery] = useState('')

  useEffect(() => {
    const el = ref.current
    if (!el) return
    let inst = instances.get(pane.ptyId)
    if (!inst) {
      inst = createInstance(pane)
      instances.set(pane.ptyId, inst)
    }
    el.appendChild(inst.host)
    const fitNow = () => {
      if (!el.offsetWidth || !el.offsetHeight) return
      try {
        inst!.fit.fit()
      } catch {
        /* not laid out yet */
      }
    }
    const ro = new ResizeObserver(() => requestAnimationFrame(fitNow))
    ro.observe(el)
    requestAnimationFrame(fitNow)
    return () => {
      ro.disconnect()
      if (inst!.host.parentElement === el) el.removeChild(inst!.host)
    }
  }, [pane.ptyId])

  useEffect(() => {
    const inst = instances.get(pane.ptyId)
    if (!inst || !visible) return
    requestAnimationFrame(() => {
      try {
        inst.fit.fit()
      } catch {
        /* hidden */
      }
      inst.term.refresh(0, inst.term.rows - 1)
      if (active) inst.term.focus()
    })
  }, [visible, active, pane.ptyId])

  useEffect(() => {
    const onSearch = (e: Event) => {
      if ((e as CustomEvent<string>).detail === pane.ptyId) setSearching(true)
    }
    window.addEventListener('pi-desktop:terminal-search', onSearch)
    return () => window.removeEventListener('pi-desktop:terminal-search', onSearch)
  }, [pane.ptyId])

  const find = (next: boolean) => {
    const inst = instances.get(pane.ptyId)
    if (!inst || !query) return
    const opts = { caseSensitive: false, decorations: { matchOverviewRuler: '#888', activeMatchColorOverviewRuler: '#165dff' } }
    if (next) inst.search.findNext(query, opts)
    else inst.search.findPrevious(query, opts)
  }

  return (
    <div
      className={cn('relative min-h-0 min-w-0 flex-1 overflow-hidden', !active && 'terminal-pane-inactive')}
      onMouseDown={() => !active && terminalActions.focusPane(tabId, index)}
    >
      <div ref={ref} className="absolute inset-0 py-1 pl-2.5 pr-1" />
      {searching ? (
        <div className="absolute right-3 top-2 z-10 flex items-center gap-1 rounded-md border border-border bg-popover px-2 py-1 shadow-sm">
          <input
            autoFocus
            value={query}
            placeholder={t('common:terminal.find')}
            className="w-44 bg-transparent text-[12px] text-foreground outline-none placeholder:text-foreground-tertiary"
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') find(!e.shiftKey)
              if (e.key === 'Escape') {
                setSearching(false)
                instances.get(pane.ptyId)?.search.clearDecorations()
                instances.get(pane.ptyId)?.term.focus()
              }
            }}
          />
        </div>
      ) : null}
      {pane.exited !== undefined ? (
        <div className="pointer-events-none absolute bottom-2 right-3 text-[11px] text-foreground-tertiary">
          {t('common:terminal.exited', { code: pane.exited })}
        </div>
      ) : null}
    </div>
  )
}

/** Kill-and-forget a pane's process and terminal (closing its tab or pane). */
export function useClosePane() {
  return (ptyId: string) => {
    const pane = useTerminalStore.getState().tabs.flatMap((t) => t.panes).find((p) => p.ptyId === ptyId)
    terminalActions.closePane(ptyId)
    disposeTerminalInstance(ptyId)
    if (pane && pane.exited === undefined) void ipcClient.invoke('terminal.kill', { id: ptyId }).catch(() => {})
  }
}
