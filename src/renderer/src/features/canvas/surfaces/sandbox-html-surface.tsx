import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import type { CanvasHtmlPayload, CanvasSurface } from '@shared/canvas-types'
import {
  AlertTriangle,
  Check,
  Copy,
  FileCode2,
  Loader2,
  MessageSquarePlus,
  Monitor,
  RefreshCw,
  RotateCcw,
  Smartphone,
  Target,
} from '@renderer/components/icons'
import { cn } from '@renderer/lib/utils'
import { ipcClient } from '@renderer/lib/ipc-client'
import { useUIStore } from '@renderer/stores/ui-store'
import { quoteCanvasToComposer, useCanvasStore } from '../canvas-store'
import { useCanvasFileSync } from '../use-canvas-file-sync'
import {
  CanvasSelectionPopover,
  useTextSelectionAnchor,
  type CanvasSelectionAnchor,
} from '../canvas-selection-popover'

const THEME_VAR_KEYS = [
  '--bg-base',
  '--bg-1',
  '--bg-2',
  '--bg-hover',
  '--border-base',
  '--text-primary',
  '--text-secondary',
  '--brand',
  '--success-semantic',
  '--warning-semantic',
  '--danger-semantic',
  '--font-sans',
  '--font-mono',
] as const

type LucideIconNode = [string, Record<string, string | number>]

interface CompiledPrototypeState {
  mode: 'html' | 'react'
  compiledMain?: string
  compiledFiles?: Record<string, string>
  tailwindCss: string
  lucideIcons?: Record<string, LucideIconNode[]>
}

interface CompileErrorState {
  message: string
  file?: string
  line?: number
  column?: number
}

// Keep one cached copy of the offline React 18 runtime in renderer memory so subsequent compiles skip IPC transfer.
let cachedReactRuntimeJs: string | null = null

function escapeInlineScript(code: string): string {
  return code.replace(/<\/script/gi, '<\\/script')
}

function collectThemeVars(): { dark: boolean; vars: Record<string, string>; cssText: string } {
  if (typeof document === 'undefined') return { dark: false, vars: {}, cssText: '' }
  const style = getComputedStyle(document.documentElement)
  const vars: Record<string, string> = {}
  const pairs: string[] = []
  for (const key of THEME_VAR_KEYS) {
    const value = style.getPropertyValue(key).trim()
    if (value) {
      vars[key] = value
      pairs.push(`${key}: ${value};`)
    }
  }
  const dark = document.documentElement.classList.contains('dark')
  return {
    dark,
    vars,
    cssText: `:root { color-scheme: ${dark ? 'dark' : 'light'}; ${pairs.join(' ')} }`,
  }
}

function detectClientMode(payload: CanvasHtmlPayload, source: string): 'html' | 'react' {
  if (payload.mode === 'react' || payload.mode === 'html') return payload.mode
  const fp = (payload.filePath ?? '').trim().toLowerCase()
  if (fp.endsWith('.tsx') || fp.endsWith('.jsx')) return 'react'
  if (fp.endsWith('.html') || fp.endsWith('.htm')) return 'html'
  if (payload.files && Object.keys(payload.files).some((k) => /\.(?:tsx|jsx|ts|js)$/i.test(k))) {
    return 'react'
  }
  const trimmed = source.trim()
  if (!trimmed || /^<!doctype\s+html|^<html[\s>]/i.test(trimmed)) return 'html'
  if (
    /import\s+[\s\S]*?from\s+['"](?:react|lucide-react)['"]/.test(trimmed) ||
    /export\s+default\s+(?:function|class|const|\()/.test(trimmed) ||
    /\buse(?:State|Effect|Memo|Callback|Ref|Reducer)\s*(?:<[^>]*>)?\s*\(/.test(trimmed)
  ) {
    return 'react'
  }
  return 'html'
}

type ViewportPreset = 'auto' | 'mobile' | 'tablet' | 'desktop'

const VIEWPORT_WIDTHS: Record<ViewportPreset, number | null> = {
  auto: null,
  mobile: 390,
  tablet: 768,
  desktop: 1280,
}

const SANDBOX_BRIDGE_SCRIPT = `<script>
(function () {
  var send = function (type, detail) {
    try { parent.postMessage({ source: 'pi-canvas-sandbox', type: type, detail: detail }, '*'); } catch (_) {}
  };
  window.piCanvas = { emit: send };
  window.addEventListener('error', function (e) {
    send('runtime-error', {
      message: e.message || 'Script error',
      line: e.lineno || 0,
      col: e.colno || 0
    });
  });
  window.addEventListener('unhandledrejection', function (e) {
    var reason = e.reason;
    send('runtime-error', {
      message: reason && reason.message ? String(reason.message) : String(reason || 'Unhandled rejection')
    });
  });
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      if (pickerActive) setPickerActive(false);
      send('escape', {});
    }
  });

  // Live theme & picker state sync from host
  var pickerActive = false;
  var overlayBox = null;
  var overlayTag = null;

  function ensurePickerOverlay() {
    if (overlayBox) return;
    overlayBox = document.createElement('div');
    overlayBox.id = '__pi_picker_box';
    overlayBox.style.cssText = 'position:fixed;pointer-events:none;z-index:2147483646;border:2px solid #2563eb;background:rgba(37,99,235,0.10);border-radius:4px;display:none;box-sizing:border-box;';
    overlayTag = document.createElement('div');
    overlayTag.id = '__pi_picker_label';
    overlayTag.style.cssText = 'position:fixed;pointer-events:none;z-index:2147483647;background:#1e293b;color:#f8fafc;font:11px/1.3 ui-monospace,SFMono-Regular,monospace;padding:2px 6px;border-radius:4px;white-space:nowrap;display:none;box-shadow:0 2px 8px rgba(0,0,0,0.25);';
    document.documentElement.appendChild(overlayBox);
    document.documentElement.appendChild(overlayTag);
  }

  function hidePickerOverlay() {
    if (overlayBox) overlayBox.style.display = 'none';
    if (overlayTag) overlayTag.style.display = 'none';
  }

  function setPickerActive(next) {
    pickerActive = Boolean(next);
    document.documentElement.style.cursor = pickerActive ? 'crosshair' : '';
    if (!pickerActive) hidePickerOverlay();
  }

  function cssSelectorFor(el) {
    if (!el || el.nodeType !== 1) return '';
    if (el.id) return '#' + el.id;
    var parts = [];
    var cur = el;
    var depth = 0;
    while (cur && cur.nodeType === 1 && cur !== document.documentElement && depth < 5) {
      var seg = cur.tagName.toLowerCase();
      if (cur.id) {
        parts.unshift('#' + cur.id);
        break;
      }
      var cls = typeof cur.className === 'string'
        ? cur.className.trim().split(/\\s+/).filter(function (c) { return c && c.indexOf(':') < 0 && c.indexOf('[') < 0; }).slice(0, 2)
        : [];
      if (cls.length) seg += '.' + cls.join('.');
      var parent = cur.parentElement;
      if (parent) {
        var siblings = Array.prototype.filter.call(parent.children, function (c) { return c.tagName === cur.tagName; });
        if (siblings.length > 1) {
          seg += ':nth-of-type(' + (siblings.indexOf(cur) + 1) + ')';
        }
      }
      parts.unshift(seg);
      cur = parent;
      depth++;
    }
    return parts.join(' > ');
  }

  document.addEventListener('mousemove', function (e) {
    if (!pickerActive) return;
    var el = document.elementFromPoint(e.clientX, e.clientY);
    if (!el || el === overlayBox || el === overlayTag || el === document.documentElement || el === document.body) {
      hidePickerOverlay();
      return;
    }
    ensurePickerOverlay();
    var r = el.getBoundingClientRect();
    overlayBox.style.display = 'block';
    overlayBox.style.left = r.left + 'px';
    overlayBox.style.top = r.top + 'px';
    overlayBox.style.width = r.width + 'px';
    overlayBox.style.height = r.height + 'px';
    var tagName = el.tagName.toLowerCase();
    var cls = typeof el.className === 'string' && el.className.trim()
      ? '.' + el.className.trim().split(/\\s+/).slice(0, 2).join('.')
      : '';
    overlayTag.textContent = tagName + cls + '  ' + Math.round(r.width) + 'x' + Math.round(r.height);
    overlayTag.style.display = 'block';
    overlayTag.style.left = Math.max(4, Math.min(window.innerWidth - 180, r.left)) + 'px';
    overlayTag.style.top = (r.top > 24 ? r.top - 22 : r.bottom + 4) + 'px';
  }, true);

  document.addEventListener('click', function (e) {
    if (!pickerActive) return;
    var el = document.elementFromPoint(e.clientX, e.clientY);
    if (!el || el === overlayBox || el === overlayTag) return;
    e.preventDefault();
    e.stopPropagation();
    var r = el.getBoundingClientRect();
    var selector = cssSelectorFor(el);
    var text = (el.innerText || el.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 320);
    var html = (el.outerHTML || '').slice(0, 620);
    setPickerActive(false);
    send('element-picked', {
      selector: selector,
      tagName: el.tagName.toLowerCase(),
      text: text,
      html: html,
      rect: { left: r.left, top: r.top, width: r.width, height: r.height }
    });
  }, true);

  document.addEventListener('mouseup', function () {
    if (pickerActive) return;
    var sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return;
    var text = sel.toString().trim();
    if (text.length < 2) return;
    var r = sel.getRangeAt(0).getBoundingClientRect();
    if (r.width <= 0 && r.height <= 0) return;
    send('text-selection', {
      text: text.slice(0, 700),
      rect: { left: r.left, top: r.top, width: r.width, height: r.height }
    });
  });

  window.addEventListener('message', function (e) {
    var d = e.data;
    if (!d || d.source !== 'pi-canvas-host') return;
    if (d.type === 'theme-vars') {
      var root = document.documentElement;
      if (typeof d.dark === 'boolean') {
        root.style.colorScheme = d.dark ? 'dark' : 'light';
        root.classList.toggle('dark', d.dark);
      }
      if (d.vars && typeof d.vars === 'object') {
        Object.keys(d.vars).forEach(function (k) { root.style.setProperty(k, d.vars[k]); });
      }
    } else if (d.type === 'picker-mode') {
      setPickerActive(Boolean(d.enabled));
    }
  });
})();
</script>`

function buildReactMountBootstrap(compiled: CompiledPrototypeState): string {
  const payloadJson = escapeInlineScript(
    JSON.stringify({
      main: compiled.compiledMain ?? '',
      files: compiled.compiledFiles ?? {},
      lucideIcons: compiled.lucideIcons ?? {},
    }),
  )
  return `<script>
(function () {
  var rt = window.__PI_CANVAS_RUNTIME__;
  if (!rt || !rt.React || !rt.ReactDOMClient) {
    window.piCanvas && window.piCanvas.emit('runtime-error', { message: 'Offline React runtime unavailable' });
    return;
  }
  var React = rt.React;
  var ReactDOM = rt.ReactDOM;
  var ReactDOMClient = rt.ReactDOMClient;
  var JsxRuntime = rt.JsxRuntime;
  var clsx = rt.clsx;
  var twMerge = rt.twMerge;
  window.React = React;
  var bundle = ${payloadJson};

  function makeLucideIcon(name, nodes) {
    return React.forwardRef(function LucideIcon(props, ref) {
      var size = props.size != null ? props.size : 20;
      var color = props.color != null ? props.color : 'currentColor';
      var strokeWidth = props.strokeWidth != null ? props.strokeWidth : 2;
      var rest = {};
      for (var k in props) {
        if (k !== 'size' && k !== 'color' && k !== 'strokeWidth' && k !== 'children') rest[k] = props[k];
      }
      var kids = (nodes || []).map(function (entry, idx) {
        var attrs = Object.assign({ key: idx }, entry[1] || {});
        return React.createElement(entry[0], attrs);
      });
      if (props.children) kids.push(props.children);
      return React.createElement('svg', Object.assign({
        ref: ref,
        xmlns: 'http://www.w3.org/2000/svg',
        width: size,
        height: size,
        viewBox: '0 0 24 24',
        fill: 'none',
        stroke: color,
        strokeWidth: strokeWidth,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        'data-lucide': name
      }, rest), kids);
    });
  }

  var lucideCache = {};
  var rawIcons = bundle.lucideIcons || {};
  Object.keys(rawIcons).forEach(function (name) {
    lucideCache[name] = makeLucideIcon(name, rawIcons[name]);
  });
  var lucideExports = typeof Proxy !== 'undefined'
    ? new Proxy(lucideCache, {
        get: function (target, prop) {
          if (prop === '__esModule') return true;
          if (typeof prop === 'string' && prop in target) return target[prop];
          if (typeof prop === 'string' && /^[A-Z]/.test(prop)) {
            target[prop] = makeLucideIcon(prop, [['circle', { cx: 12, cy: 12, r: 9 }]]);
            return target[prop];
          }
          return target[prop];
        }
      })
    : lucideCache;

  var builtins = {
    react: Object.assign({ __esModule: true, default: React }, React),
    'react-dom': Object.assign({ __esModule: true, default: ReactDOM }, ReactDOM),
    'react-dom/client': Object.assign({ __esModule: true, default: ReactDOMClient }, ReactDOMClient),
    'react/jsx-runtime': Object.assign({ __esModule: true }, JsxRuntime),
    'lucide-react': lucideExports,
    clsx: Object.assign({ __esModule: true, default: clsx, clsx: clsx }),
    'tailwind-merge': Object.assign({ __esModule: true, twMerge: twMerge })
  };

  function normMod(id) {
    var s = String(id || '').replace(/\\\\/g, '/').trim();
    if (s.charAt(0) === '/') s = '.' + s;
    return s.replace(/\\.(?:tsx|ts|jsx|js|mjs)$/i, '');
  }

  var moduleCache = {};
  function localRequire(id) {
    if (id in builtins) return builtins[id];
    var key = normMod(id);
    if (key in moduleCache) return moduleCache[key].exports;
    var src = bundle.files && bundle.files[key];
    if (typeof src !== 'string') {
      throw new Error('Cannot resolve offline sandbox module: ' + id);
    }
    var mod = { exports: {} };
    moduleCache[key] = mod;
    var fn = new Function('require', 'module', 'exports', 'React', src);
    fn(localRequire, mod, mod.exports, React);
    return mod.exports;
  }

  class SandboxErrorBoundary extends React.Component {
    constructor(props) {
      super(props);
      this.state = { error: null };
    }
    static getDerivedStateFromError(error) {
      return { error: error };
    }
    componentDidCatch(error) {
      window.piCanvas && window.piCanvas.emit('runtime-error', {
        message: error && error.message ? String(error.message) : String(error)
      });
    }
    render() {
      if (this.state.error) {
        return React.createElement('div', {
          style: {
            padding: '16px',
            margin: '12px',
            borderRadius: '10px',
            border: '1px solid rgba(239,68,68,0.4)',
            background: 'rgba(239,68,68,0.08)',
            color: '#ef4444',
            fontFamily: 'ui-monospace, SFMono-Regular, monospace',
            fontSize: '12px',
            whiteSpace: 'pre-wrap'
          }
        }, 'React Render Error: ' + (this.state.error.message || String(this.state.error)));
      }
      return this.props.children;
    }
  }

  try {
    var mainMod = { exports: {} };
    var execMain = new Function('require', 'module', 'exports', 'React', bundle.main);
    execMain(localRequire, mainMod, mainMod.exports, React);
    var exp = mainMod.exports;
    var RootComp = (exp && (exp.default || exp.App || exp.Component)) || null;
    if (!RootComp && exp && typeof exp === 'object') {
      var keys = Object.keys(exp);
      for (var i = 0; i < keys.length; i++) {
        if (typeof exp[keys[i]] === 'function') { RootComp = exp[keys[i]]; break; }
      }
    }
    var rootEl = document.getElementById('root');
    if (RootComp && rootEl) {
      ReactDOMClient.createRoot(rootEl).render(
        React.createElement(SandboxErrorBoundary, null, React.createElement(RootComp))
      );
    } else if (rootEl && !rootEl.childNodes.length) {
      window.piCanvas && window.piCanvas.emit('runtime-error', {
        message: 'React prototype must export a default component (export default function App() { ... })'
      });
    }
  } catch (err) {
    window.piCanvas && window.piCanvas.emit('runtime-error', {
      message: err && err.message ? String(err.message) : String(err)
    });
  }
})();
</script>`
}

interface RuntimeErrorItem {
  message: string
  line?: number
  at: number
}

export function SandboxHtmlSurface({ surface }: { surface: CanvasSurface }) {
  const payload = surface.payload as CanvasHtmlPayload
  const recordInteraction = useCanvasStore((s) => s.recordInteraction)
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const sourcePreRef = useRef<HTMLPreElement>(null)

  const fileSync = useCanvasFileSync({
    filePath: payload.filePath,
    watch: payload.watch !== false && Boolean(payload.filePath),
    mode: 'text',
  })

  const rawSource = fileSync.content ?? payload.code ?? payload.html ?? ''
  const detectedMode = useMemo(() => detectClientMode(payload, rawSource), [payload, rawSource])
  const wantsTailwind = payload.tailwind !== false

  const [compiled, setCompiled] = useState<CompiledPrototypeState | null>(null)
  const [compileError, setCompileError] = useState<CompileErrorState | null>(null)
  const [compiling, setCompiling] = useState(false)
  const [lastEvent, setLastEvent] = useState<string | null>(null)
  const [runtimeErrors, setRuntimeErrors] = useState<RuntimeErrorItem[]>([])
  const [errorsExpanded, setErrorsExpanded] = useState(false)
  const [showSource, setShowSource] = useState(false)
  const [pickerActive, setPickerActive] = useState(false)
  const [pickedAnchor, setPickedAnchor] = useState<CanvasSelectionAnchor | null>(null)
  const [copied, setCopied] = useState(false)
  const [reloadNonce, setReloadNonce] = useState(0)
  const [viewport, setViewport] = useState<ViewportPreset>(payload.viewport ?? 'auto')

  const sourceSelection = useTextSelectionAnchor({
    containerRef: sourcePreRef,
    surface,
    filePath: payload.filePath,
    mode: 'source',
    sourceText: rawSource,
    enabled: showSource,
  })

  const filesKey = useMemo(() => JSON.stringify(payload.files ?? null), [payload.files])

  // Compile JSX/TSX and/or real Tailwind CSS offline through the main-process lazy compiler.
  useEffect(() => {
    const needsCompile = detectedMode === 'react' || wantsTailwind
    if (!needsCompile || !rawSource.trim()) {
      setCompiled(null)
      setCompileError(null)
      setCompiling(false)
      return
    }
    if (typeof window !== 'undefined' && !window.piDesktop) {
      setCompiled(null)
      setCompileError(null)
      setCompiling(false)
      return
    }

    let cancelled = false
    setCompiling(true)
    void ipcClient
      .invoke('canvas.prototype.compile', {
        mode: detectedMode,
        code: rawSource,
        css: payload.css,
        files: payload.files,
        filePath: payload.filePath,
        tailwind: wantsTailwind,
        includeRuntime: detectedMode === 'react' && !cachedReactRuntimeJs,
      })
      .then((res) => {
        if (cancelled) return
        setCompiling(false)
        if (!res || typeof res.ok !== 'boolean') {
          setCompiled(null)
          setCompileError(null)
          return
        }
        if (!res.ok) {
          const errState: CompileErrorState = {
            message: String(res.error || 'Prototype compile failed'),
            file: typeof res.file === 'string' ? res.file : undefined,
            line: typeof res.line === 'number' ? res.line : undefined,
            column: typeof res.column === 'number' ? res.column : undefined,
          }
          setCompileError(errState)
          recordInteraction(surface.id, { compileError: errState })
          return
        }
        if (typeof res.runtimeJs === 'string' && res.runtimeJs.length > 0) {
          cachedReactRuntimeJs = res.runtimeJs
        }
        setCompileError(null)
        setCompiled({
          mode: res.mode === 'react' ? 'react' : 'html',
          compiledMain: typeof res.compiledMain === 'string' ? res.compiledMain : undefined,
          compiledFiles: res.compiledFiles as Record<string, string> | undefined,
          tailwindCss: typeof res.tailwindCss === 'string' ? res.tailwindCss : '',
          lucideIcons: res.lucideIcons as Record<string, LucideIconNode[]> | undefined,
        })
      })
      .catch((err) => {
        if (cancelled) return
        setCompiling(false)
        if (detectedMode === 'react') {
          setCompileError({ message: err instanceof Error ? err.message : String(err) })
        }
      })

    return () => {
      cancelled = true
    }
  }, [detectedMode, filesKey, payload.css, payload.filePath, payload.files, rawSource, recordInteraction, surface.id, wantsTailwind])

  const pushThemeVarsToIframe = useCallback(() => {
    const win = iframeRef.current?.contentWindow
    if (!win) return
    const { dark, vars } = collectThemeVars()
    win.postMessage({ source: 'pi-canvas-host', type: 'theme-vars', dark, vars }, '*')
  }, [])

  const pushPickerModeToIframe = useCallback((enabled: boolean) => {
    const win = iframeRef.current?.contentWindow
    if (!win) return
    win.postMessage({ source: 'pi-canvas-host', type: 'picker-mode', enabled }, '*')
  }, [])

  useEffect(() => {
    if (showSource) {
      setPickerActive(false)
    }
    setPickedAnchor(null)
  }, [showSource])

  useEffect(() => {
    pushPickerModeToIframe(pickerActive)
  }, [pickerActive, pushPickerModeToIframe])

  // Live theme hot-update via postMessage: never destroys iframe JS / React state when theme/zoom changes!
  useEffect(() => {
    const observer = new MutationObserver(() => pushThemeVarsToIframe())
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style'] })
    return () => observer.disconnect()
  }, [pushThemeVarsToIframe])

  // Clear stale runtime errors whenever source or manual reload updates.
  useEffect(() => {
    setRuntimeErrors([])
  }, [rawSource, payload.css, reloadNonce])

  // Strictly scope postMessage listener to THIS iframe's contentWindow (prevents cross-surface leakage).
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      const iframeWin = iframeRef.current?.contentWindow
      if (!iframeWin || e.source !== iframeWin) return
      const data = e.data as { source?: string; type?: string; detail?: unknown } | null
      if (!data || data.source !== 'pi-canvas-sandbox') return

      if (data.type === 'escape') {
        setPickerActive(false)
        setPickedAnchor(null)
        if (useUIStore.getState().canvasChatExpand) {
          useUIStore.setState({ canvasChatExpand: false })
        }
        return
      }

      if (data.type === 'element-picked') {
        setPickerActive(false)
        const d = (data.detail ?? {}) as {
          selector?: string
          tagName?: string
          text?: string
          html?: string
          rect?: { left: number; top: number; width: number; height: number }
        }
        const iframeRect = iframeRef.current?.getBoundingClientRect()
        const localRect = d.rect ?? { left: 40, top: 40, width: 120, height: 32 }
        setPickedAnchor({
          surfaceId: surface.id,
          surfaceTitle: surface.title,
          surfaceKind: surface.kind,
          filePath: payload.filePath,
          anchorType: 'element',
          locationLabel: d.selector || d.tagName || 'DOM 元素',
          excerpt: String(d.text ?? '').trim(),
          htmlSnippet: typeof d.html === 'string' ? d.html : undefined,
          rect: {
            left: (iframeRect?.left ?? 0) + localRect.left,
            top: (iframeRect?.top ?? 0) + localRect.top,
            width: localRect.width,
            height: localRect.height,
          },
        })
        return
      }

      if (data.type === 'text-selection') {
        const d = (data.detail ?? {}) as {
          text?: string
          rect?: { left: number; top: number; width: number; height: number }
        }
        const text = String(d.text ?? '').trim()
        if (text.length < 2) return
        const iframeRect = iframeRef.current?.getBoundingClientRect()
        const localRect = d.rect ?? { left: 40, top: 40, width: 120, height: 24 }
        setPickedAnchor({
          surfaceId: surface.id,
          surfaceTitle: surface.title,
          surfaceKind: surface.kind,
          filePath: payload.filePath,
          anchorType: 'text',
          locationLabel: detectedMode === 'react' ? 'React 预览文本' : 'HTML 预览文本',
          excerpt: text,
          rect: {
            left: (iframeRect?.left ?? 0) + localRect.left,
            top: (iframeRect?.top ?? 0) + localRect.top,
            width: localRect.width,
            height: localRect.height,
          },
        })
        return
      }

      if (data.type === 'runtime-error') {
        const detail = (data.detail ?? {}) as { message?: string; line?: number }
        const entry: RuntimeErrorItem = {
          message: String(detail.message || 'Unknown error'),
          line: typeof detail.line === 'number' && detail.line > 0 ? detail.line : undefined,
          at: Date.now(),
        }
        setRuntimeErrors((prev) => {
          const next = [...prev.slice(-7), entry]
          recordInteraction(surface.id, { runtimeErrors: next })
          return next
        })
        return
      }

      const summary = `${data.type ?? 'event'}: ${JSON.stringify(data.detail ?? {})}`
      setLastEvent(summary)
      recordInteraction(surface.id, { lastSandboxEvent: { type: data.type, detail: data.detail } })
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [detectedMode, payload.filePath, recordInteraction, surface.id, surface.kind, surface.title])

  // Initial snapshot of theme vars baked once per source/compile change (subsequent theme updates go through postMessage).
  const srcDoc = useMemo(() => {
    void reloadNonce
    const { dark, cssText } = collectThemeVars()
    const htmlClass = dark ? ' class="dark"' : ''
    const cspMeta = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data: blob:; font-src data:;" />`
    const twCss = compiled?.tailwindCss ?? ''
    const styleBlock = `<style>\n${cssText}\n${twCss}\n* { box-sizing: border-box; }\n${payload.css ?? ''}\n</style>`

    if (detectedMode === 'react' && compiled?.mode === 'react' && compiled.compiledMain) {
      const runtimeTag = cachedReactRuntimeJs
        ? `<script>${escapeInlineScript(cachedReactRuntimeJs)}</script>`
        : ''
      const mountTag = buildReactMountBootstrap(compiled)
      return `<!doctype html>
<html${htmlClass}>
<head>
<meta charset="utf-8" />
${cspMeta}
${styleBlock}
${SANDBOX_BRIDGE_SCRIPT}
</head>
<body>
<div id="root"></div>
${runtimeTag}
${mountTag}
</body>
</html>`
    }

    const isFullDoc = /<!doctype\s+html|<html[\s>]/i.test(rawSource)
    if (isFullDoc) {
      if (/<head[^>]*>/i.test(rawSource)) {
        return rawSource.replace(/<head([^>]*)>/i, `<head$1>\n${cspMeta}\n${styleBlock}\n${SANDBOX_BRIDGE_SCRIPT}`)
      }
      return `${cspMeta}\n${styleBlock}\n${SANDBOX_BRIDGE_SCRIPT}\n${rawSource}`
    }

    return `<!doctype html>
<html${htmlClass}>
<head>
<meta charset="utf-8" />
${cspMeta}
${styleBlock}
${SANDBOX_BRIDGE_SCRIPT}
</head>
<body>${rawSource}</body>
</html>`
  }, [compiled, detectedMode, payload.css, rawSource, reloadNonce])

  const copySource = () => {
    void navigator.clipboard.writeText(rawSource).then(() => {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1400)
    })
  }

  const quoteToChat = (includeErrors = false) => {
    const lines = [`[画布 ${detectedMode === 'react' ? 'React/TSX' : 'HTML'} 原型 · ${surface.title}]`]
    if (payload.filePath) lines.push(`文件: ${payload.filePath}`)
    if (lastEvent) lines.push(`最近交互事件: ${lastEvent}`)
    if (includeErrors && compileError) {
      lines.push(
        `编译错误: ${compileError.file ? `${compileError.file}` : ''}${compileError.line ? `:${compileError.line}` : ''} ${compileError.message}`,
      )
    }
    if (includeErrors && runtimeErrors.length > 0) {
      lines.push(
        `运行时报错 (${runtimeErrors.length}):\n${runtimeErrors
          .map((err) => `- ${err.line ? `L${err.line}: ` : ''}${err.message}`)
          .join('\n')}`,
      )
    }
    quoteCanvasToComposer(lines.join('\n'))
    toast.success(includeErrors ? '已将报错信息插入输入框' : '已引用画布原型状态到输入框')
  }

  const viewportWidth = VIEWPORT_WIDTHS[viewport]
  const activeAnchor = showSource ? sourceSelection.anchor : pickedAnchor

  return (
    <div data-canvas-surface-id={surface.id} className="flex h-full min-h-0 flex-col bg-[var(--bg-base)]">
      {/* Compact Prototype Toolbar */}
      <div className="flex h-8 shrink-0 items-center justify-between gap-2 border-b border-border/30 px-3 text-[11px] text-foreground-secondary">
        <div className="flex min-w-0 items-center gap-1">
          <span className="rounded bg-[var(--bg-2)] px-1.5 py-0.5 font-mono text-[10px] uppercase text-foreground-secondary">
            {detectedMode === 'react' ? 'TSX' : 'HTML'}
          </span>
          {wantsTailwind ? (
            <span className="hidden rounded bg-[var(--bg-2)]/70 px-1 py-0.5 font-mono text-[9.5px] opacity-75 sm:inline">
              TW
            </span>
          ) : null}
          {compiling ? <Loader2 className="h-3 w-3 animate-spin opacity-70" /> : null}
          <button
            type="button"
            onClick={() => setViewport('auto')}
            title="自适应宽度"
            className={cn(
              'ml-0.5 rounded px-1.5 py-0.5 text-[10.5px] transition-colors',
              viewport === 'auto' ? 'bg-foreground/[0.08] font-medium text-foreground' : 'hover:bg-foreground/[0.05]',
            )}
          >
            自适应
          </button>
          <button
            type="button"
            onClick={() => setViewport('mobile')}
            title="移动端视口 (390px)"
            aria-label="移动端视口"
            className={cn(
              'flex h-6 w-6 items-center justify-center rounded-md transition-colors',
              viewport === 'mobile' ? 'bg-foreground/[0.08] text-foreground' : 'hover:bg-foreground/[0.05]',
            )}
          >
            <Smartphone className="h-3 w-3" />
          </button>
          <button
            type="button"
            onClick={() => setViewport('desktop')}
            title="桌面视口 (1280px)"
            aria-label="桌面视口"
            className={cn(
              'flex h-6 w-6 items-center justify-center rounded-md transition-colors',
              viewport === 'desktop' ? 'bg-foreground/[0.08] text-foreground' : 'hover:bg-foreground/[0.05]',
            )}
          >
            <Monitor className="h-3 w-3" />
          </button>
          {payload.filePath ? (
            <span className="ml-1 truncate font-mono text-[10px] opacity-70" title={fileSync.absPath || payload.filePath}>
              {payload.filePath}
            </span>
          ) : null}
          {fileSync.watching ? (
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" title="文件热重载已开启" />
          ) : null}
        </div>

        <div className="flex shrink-0 items-center gap-0.5">
          {!showSource ? (
            <button
              type="button"
              onClick={() => {
                setPickedAnchor(null)
                setPickerActive((v) => !v)
              }}
              aria-pressed={pickerActive}
              title={pickerActive ? '取消元素拾取 (Esc)' : '拾取页面元素发起局部修改'}
              className={cn(
                'inline-flex h-6 items-center gap-1 rounded-md px-1.5 text-[10.5px] font-medium transition-colors',
                pickerActive
                  ? 'bg-[var(--brand)]/15 text-[var(--brand)]'
                  : 'hover:bg-foreground/[0.05] hover:text-foreground',
              )}
            >
              <Target className="h-3 w-3" />
              <span>{pickerActive ? '拾取中' : '拾取'}</span>
            </button>
          ) : null}
          {payload.filePath ? (
            <button
              type="button"
              onClick={fileSync.reload}
              title="重新读取文件"
              className="flex h-6 w-6 items-center justify-center rounded-md hover:bg-foreground/[0.05] hover:text-foreground"
            >
              <RefreshCw className={cn('h-3 w-3', fileSync.loading && 'animate-spin')} />
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => setReloadNonce((n) => n + 1)}
            title="重置沙箱状态"
            aria-label="重置沙箱状态"
            className="flex h-6 w-6 items-center justify-center rounded-md hover:bg-foreground/[0.05] hover:text-foreground"
          >
            <RotateCcw className="h-3 w-3" />
          </button>
          <button
            type="button"
            onClick={() => setShowSource((v) => !v)}
            title={showSource ? '返回预览' : '查看源码'}
            aria-pressed={showSource}
            className={cn(
              'flex h-6 w-6 items-center justify-center rounded-md transition-colors',
              showSource ? 'bg-foreground/[0.08] text-foreground' : 'hover:bg-foreground/[0.05] hover:text-foreground',
            )}
          >
            <FileCode2 className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={copySource}
            title="复制源码"
            className="flex h-6 w-6 items-center justify-center rounded-md hover:bg-foreground/[0.05] hover:text-foreground"
          >
            {copied ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
          </button>
          <button
            type="button"
            onClick={() => quoteToChat(false)}
            title="引用状态到对话"
            className="ml-0.5 inline-flex h-6 items-center gap-1 rounded-md border border-border/50 bg-background px-2 text-[11px] font-medium text-foreground-secondary transition-colors hover:border-border hover:text-foreground"
          >
            <MessageSquarePlus className="h-3 w-3" />
            <span>引用</span>
          </button>
        </div>
      </div>

      {fileSync.error ? (
        <div className="border-b border-destructive/30 bg-destructive/[0.06] px-3 py-1.5 text-[11px] text-destructive">
          文件读取失败：{fileSync.error}
        </div>
      ) : null}

      {compileError ? (
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-destructive/30 bg-destructive/[0.06] px-3 py-1.5 text-[11px] text-destructive">
          <div className="flex min-w-0 items-center gap-1.5">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate font-mono">
              编译失败{compileError.line ? ` (L${compileError.line})` : ''}: {compileError.message}
            </span>
          </div>
          <button
            type="button"
            onClick={() => quoteToChat(true)}
            className="shrink-0 rounded bg-destructive/15 px-1.5 py-0.5 text-[10.5px] font-medium text-destructive hover:bg-destructive/25"
          >
            发给 AI 修复
          </button>
        </div>
      ) : null}

      {showSource ? (
        <pre
          ref={sourcePreRef}
          className="min-h-0 flex-1 select-text overflow-auto bg-[var(--bg-1)]/40 p-3.5 font-mono text-[12px] leading-relaxed text-foreground"
        >
          {rawSource}
        </pre>
      ) : (
        <div
          className={cn(
            'flex min-h-0 flex-1 overflow-auto',
            viewportWidth ? 'items-stretch justify-center bg-[var(--bg-1)]/55 p-3' : '',
          )}
        >
          <iframe
            ref={iframeRef}
            key={reloadNonce}
            title={payload.title || surface.title}
            sandbox={payload.allowScripts === false ? '' : 'allow-scripts'}
            srcDoc={srcDoc}
            onLoad={() => {
              pushThemeVarsToIframe()
              if (pickerActive) pushPickerModeToIframe(true)
            }}
            style={viewportWidth ? { width: viewportWidth, maxWidth: '100%' } : undefined}
            className={cn(
              'min-h-0 border-0 bg-[var(--bg-base)]',
              viewportWidth ? 'h-full shrink-0 rounded-xl border border-border/55 shadow-md' : 'w-full flex-1',
            )}
          />
        </div>
      )}

      {/* Runtime Error Diagnostics Strip (feeds AI via canvas_read or one-click send to chat) */}
      {runtimeErrors.length > 0 ? (
        <div className="shrink-0 border-t border-destructive/30 bg-destructive/[0.06] text-[11px]">
          <div className="flex h-7 items-center justify-between gap-2 px-3">
            <button
              type="button"
              onClick={() => setErrorsExpanded((v) => !v)}
              className="flex min-w-0 items-center gap-1.5 text-left font-medium text-destructive"
            >
              <AlertTriangle className="h-3 w-3 shrink-0" />
              <span className="truncate">
                沙箱报错 ({runtimeErrors.length}): {runtimeErrors[runtimeErrors.length - 1].message}
              </span>
            </button>
            <button
              type="button"
              onClick={() => quoteToChat(true)}
              className="shrink-0 rounded bg-destructive/15 px-1.5 py-0.5 text-[10.5px] font-medium text-destructive hover:bg-destructive/25"
            >
              发给 AI 修复
            </button>
          </div>
          {errorsExpanded ? (
            <div className="max-h-24 overflow-y-auto border-t border-destructive/20 px-3 py-1.5 font-mono text-[10.5px] text-destructive/90">
              {runtimeErrors.map((err, i) => (
                <div key={`${err.at}-${i}`} className="truncate">
                  {err.line ? `L${err.line}: ` : ''}
                  {err.message}
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {lastEvent ? (
        <div className="flex h-7 shrink-0 items-center justify-between gap-2 border-t border-border/25 bg-[var(--bg-1)]/45 px-3 text-[10.5px] text-foreground-secondary">
          <span className="truncate font-mono">{lastEvent}</span>
        </div>
      ) : null}

      <CanvasSelectionPopover
        anchor={activeAnchor}
        onClose={() => {
          setPickedAnchor(null)
          sourceSelection.clearAnchor()
        }}
      />
    </div>
  )
}
