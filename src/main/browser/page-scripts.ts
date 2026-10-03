/**
 * Scripts evaluated inside browser pages. Kept as plain JS source strings (not `fn.toString()`)
 * so the bundler cannot rewrite them. Unless noted, they run in an isolated world: they share
 * the DOM with the page but none of its JS globals, and they never modify the DOM.
 */

/** `(x, y) => ElementDescriptor | null` — element under a viewport point. Isolated world. */
export const INSPECT_AT_POINT = String.raw`(function (x, y) {
  var el = document.elementFromPoint(x, y);
  if (!el) return null;
  var esc = function (s) { return window.CSS && CSS.escape ? CSS.escape(s) : String(s).replace(/[^a-zA-Z0-9_-]/g, '\\$&'); };
  var unique = function (sel) { try { return document.querySelectorAll(sel).length === 1; } catch (e) { return false; } };
  var goodClass = function (c) { return /^[a-zA-Z][\w-]*$/.test(c) && c.length < 40; };
  var selectorFor = function (node) {
    if (node.id && unique('#' + esc(node.id))) return '#' + esc(node.id);
    var parts = [];
    for (var cur = node; cur && cur.nodeType === 1 && cur !== document.documentElement; cur = cur.parentElement) {
      var part = cur.tagName.toLowerCase();
      if (cur.id) part += '#' + esc(cur.id);
      var cls = Array.prototype.filter.call(cur.classList, goodClass).slice(0, 2);
      if (cls.length) part += '.' + cls.map(esc).join('.');
      var parent = cur.parentElement;
      if (parent) {
        var same = Array.prototype.filter.call(parent.children, function (c) { return c.tagName === cur.tagName; });
        if (same.length > 1) part += ':nth-of-type(' + (same.indexOf(cur) + 1) + ')';
      }
      parts.unshift(part);
      var sel = parts.join(' > ');
      if (unique(sel)) return sel;
    }
    return parts.join(' > ');
  };
  var clean = function (s, n) { return String(s || '').replace(/\s+/g, ' ').trim().slice(0, n); };
  var implicitRole = function (node) {
    var t = node.tagName.toLowerCase();
    if (t === 'a' && node.hasAttribute('href')) return 'link';
    if (t === 'button') return 'button';
    if (/^h[1-6]$/.test(t)) return 'heading';
    if (t === 'img') return 'img';
    if (t === 'textarea') return 'textbox';
    if (t === 'select') return 'combobox';
    if (t === 'input') {
      var type = (node.getAttribute('type') || 'text').toLowerCase();
      if (type === 'checkbox' || type === 'radio') return type;
      if (type === 'button' || type === 'submit' || type === 'reset') return 'button';
      return 'textbox';
    }
    var map = { nav: 'navigation', main: 'main', header: 'banner', footer: 'contentinfo', dialog: 'dialog', ul: 'list', ol: 'list', li: 'listitem', table: 'table', form: 'form' };
    return map[t];
  };
  var accessibleName = function (node) {
    var label = node.getAttribute('aria-label');
    if (label) return label;
    var by = node.getAttribute('aria-labelledby');
    if (by) {
      var text = by.split(/\s+/).map(function (id) { var n = document.getElementById(id); return n ? n.textContent : ''; }).join(' ');
      if (text.trim()) return text;
    }
    if (node.labels && node.labels.length) return node.labels[0].textContent;
    return node.getAttribute('alt') || node.getAttribute('title') || node.getAttribute('placeholder') || '';
  };
  var hintAttrs = ['data-insp-path', 'data-v-inspector', 'data-source', 'data-locator', 'data-component-file', 'data-sentry-source-file'];
  var hints = [];
  for (var a = el, depth = 0; a && a.nodeType === 1 && depth < 8; a = a.parentElement, depth++) {
    for (var i = 0; i < hintAttrs.length; i++) {
      var v = a.getAttribute(hintAttrs[i]);
      if (v && hints.indexOf(v) < 0 && hints.length < 3) hints.push(v);
    }
  }
  var cs = getComputedStyle(el);
  var styles = {};
  ['display', 'position', 'color', 'background-color', 'font-size', 'font-weight', 'line-height', 'padding', 'margin', 'border-radius', 'gap'].forEach(function (k) {
    var v = cs.getPropertyValue(k);
    if (v && v !== 'normal' && v !== 'none' && v !== '0px' && v !== 'rgba(0, 0, 0, 0)') styles[k] = v;
  });
  var r = el.getBoundingClientRect();
  var out = {
    tag: el.tagName.toLowerCase(),
    classes: Array.prototype.filter.call(el.classList, goodClass).slice(0, 6),
    selector: selectorFor(el),
    rect: { x: r.x, y: r.y, width: r.width, height: r.height },
    styles: styles,
    sourceHints: hints
  };
  if (el.id) out.id = el.id;
  var role = el.getAttribute('role') || implicitRole(el);
  if (role) out.role = role;
  var name = clean(accessibleName(el), 80);
  if (name) out.name = name;
  var text = clean(el.innerText !== undefined ? el.innerText : el.textContent, 80);
  if (text) out.text = text;
  return out;
})`

/** `(maxChars) => PageContextResult` — readable page text and the current selection. Isolated world. */
export const PAGE_CONTEXT = String.raw`(function (maxChars) {
  var root = document.querySelector('main, article, [role="main"]') || document.body;
  var raw = root ? (root.innerText !== undefined ? root.innerText : root.textContent) : '';
  var text = String(raw || '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  var sel = window.getSelection ? String(window.getSelection() || '').trim() : '';
  return {
    title: document.title || '',
    url: location.href,
    text: text.slice(0, maxChars),
    selection: sel.slice(0, 20000),
    truncated: text.length > maxChars
  };
})`

/**
 * `(x, y) => { components, sourceHints } | null` — framework source clues for the element under
 * a point. Needs the page's MAIN world (React fiber / Vue instance live on DOM node expandos), so
 * the host runs it only on dev origins, once, after the user clicks.
 */
export const FRAMEWORK_SOURCE = String.raw`(function (x, y) {
  var el = document.elementFromPoint(x, y);
  if (!el) return null;
  var comps = [], hints = [];
  var addComp = function (n) { if (n && typeof n === 'string' && comps.indexOf(n) < 0 && comps.length < 5) comps.push(n); };
  var trim = function (f) {
    f = String(f).replace(/\\/g, '/');
    var dirs = ['/src/', '/app/', '/components/', '/pages/', '/lib/'];
    for (var d = 0; d < dirs.length; d++) { var at = f.indexOf(dirs[d]); if (at >= 0) return f.slice(at + 1); }
    return f;
  };
  var addHint = function (h) { if (h && hints.indexOf(h) < 0 && hints.length < 3) hints.push(h); };
  try {
    var key = Object.keys(el).find(function (k) { return k.indexOf('__reactFiber$') === 0 || k.indexOf('__reactInternalInstance$') === 0; });
    for (var f = key ? el[key] : null, n = 0; f && n < 50; f = f.return, n++) {
      var t = f.type;
      if (t && typeof t !== 'string') addComp(t.displayName || t.name);
      var ds = f._debugSource;
      if (ds && ds.fileName) addHint(trim(ds.fileName) + ':' + ds.lineNumber);
    }
  } catch (e) {}
  try {
    var c = null;
    for (var cur = el; cur && !c; cur = cur.parentElement) c = cur.__vueParentComponent || null;
    for (var i = 0; c && i < 12; c = c.parent, i++) {
      var tp = c.type || {};
      addComp(tp.name || tp.__name);
      if (tp.__file) addHint(trim(tp.__file));
    }
  } catch (e) {}
  try {
    for (var s = el, j = 0; s && j < 12; s = s.parentElement, j++) {
      var m = s.__svelte_meta;
      if (m && m.loc) { addHint(trim(m.loc.file) + ':' + (m.loc.line + 1)); break; }
    }
  } catch (e) {}
  return { components: comps, sourceHints: hints };
})`

/**
 * `(maxChars, scopeRef) => { text, refs, truncated }` — accessibility-style outline of the page for
 * the agent. Interactive elements get stable refs (`e1`, `e2`, … per document) kept in an
 * isolated-world map of WeakRefs; nothing is written to the DOM. Isolated world, main frame.
 */
export const SNAPSHOT = String.raw`(function (maxChars, scopeRef) {
  var store = window.__piDesktopRefs || (window.__piDesktopRefs = { next: 1, map: new Map(), byEl: new WeakMap() });
  var refOf = function (el) {
    var id = store.byEl.get(el);
    if (!id) { id = 'e' + store.next++; store.byEl.set(el, id); store.map.set(id, new WeakRef(el)); }
    return id;
  };
  var clean = function (s, n) { return String(s || '').replace(/\s+/g, ' ').trim().slice(0, n); };
  var hidden = function (el) {
    if (el.hidden || el.getAttribute('aria-hidden') === 'true') return true;
    var cs = getComputedStyle(el);
    return cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0';
  };
  var implicit = { a: 'link', button: 'button', select: 'combobox', textarea: 'textbox', img: 'img', nav: 'navigation', main: 'main', header: 'banner', footer: 'contentinfo', form: 'form', dialog: 'dialog', table: 'table', ul: 'list', ol: 'list', li: 'listitem', h1: 'heading', h2: 'heading', h3: 'heading', h4: 'heading', h5: 'heading', h6: 'heading', summary: 'button', label: 'label' };
  var roleOf = function (el) {
    var r = el.getAttribute('role');
    if (r) return r.split(/\s+/)[0];
    var t = el.tagName.toLowerCase();
    if (t === 'a' && !el.hasAttribute('href')) return '';
    if (t === 'input') {
      var type = (el.getAttribute('type') || 'text').toLowerCase();
      if (type === 'hidden') return '';
      if (type === 'checkbox' || type === 'radio') return type;
      if (type === 'button' || type === 'submit' || type === 'reset' || type === 'image') return 'button';
      if (type === 'range') return 'slider';
      if (type === 'file') return 'button';
      return 'textbox';
    }
    return implicit[t] || '';
  };
  var interactiveRoles = { link: 1, button: 1, textbox: 1, checkbox: 1, radio: 1, combobox: 1, slider: 1, tab: 1, menuitem: 1, option: 1, switch: 1, searchbox: 1, spinbutton: 1, menuitemcheckbox: 1, menuitemradio: 1, treeitem: 1 };
  var isInteractive = function (el, role) {
    if (interactiveRoles[role]) return true;
    if (el.isContentEditable && el.getAttribute('contenteditable') !== null) return true;
    var ti = el.getAttribute('tabindex');
    if (ti !== null && Number(ti) >= 0) return true;
    return getComputedStyle(el).cursor === 'pointer' && !(el.parentElement && getComputedStyle(el.parentElement).cursor === 'pointer');
  };
  var nameOf = function (el) {
    var v = el.getAttribute('aria-label');
    if (v) return v;
    var by = el.getAttribute('aria-labelledby');
    if (by) {
      var s = by.split(/\s+/).map(function (id) { var n = document.getElementById(id); return n ? n.textContent : ''; }).join(' ');
      if (s.trim()) return s;
    }
    if (el.labels && el.labels.length) return el.labels[0].textContent;
    return el.getAttribute('alt') || el.getAttribute('title') || el.getAttribute('placeholder') || '';
  };
  var lines = [], size = 0, truncated = false;
  var push = function (depth, line) {
    if (truncated) return;
    var s = new Array(depth + 1).join('  ') + '- ' + line;
    if (size + s.length + 1 > maxChars) { truncated = true; return; }
    lines.push(s); size += s.length + 1;
  };
  var walk = function (node, depth) {
    if (truncated) return;
    for (var c = node.firstChild; c; c = c.nextSibling) {
      if (c.nodeType === 3) {
        var tx = clean(c.textContent, 160);
        if (tx) push(depth, 'text: ' + JSON.stringify(tx));
        continue;
      }
      if (c.nodeType !== 1) continue;
      var tag = c.tagName.toLowerCase();
      if (tag === 'script' || tag === 'style' || tag === 'noscript' || tag === 'template' || tag === 'svg' || tag === 'head') continue;
      if (hidden(c)) continue;
      var role = roleOf(c);
      var interactive = isInteractive(c, role);
      if (!role && !interactive) { walk(c, depth); continue; }
      var label = clean(nameOf(c), 80);
      var parts = [role || 'generic'];
      var own = interactive || role === 'heading' || role === 'img' ? (label || clean(c.innerText !== undefined ? c.innerText : c.textContent, 80)) : label;
      if (own) parts.push(JSON.stringify(own));
      if (role === 'heading') parts.push('[level=' + (Number(tag.slice(1)) || c.getAttribute('aria-level') || 2) + ']');
      if (interactive) parts.push('[ref=' + refOf(c) + ']');
      if ('value' in c && (role === 'textbox' || role === 'combobox' || role === 'searchbox' || role === 'slider') && c.value) parts.push('value=' + JSON.stringify(String(c.value).slice(0, 80)));
      if (c.checked) parts.push('[checked]');
      if (c.disabled || c.getAttribute('aria-disabled') === 'true') parts.push('[disabled]');
      if (role === 'link' && c.getAttribute('href')) parts.push('-> ' + c.getAttribute('href').slice(0, 120));
      push(depth, parts.join(' '));
      // Interactive leaves already carry their text; recurse into containers and landmarks.
      if (!(interactive && role !== 'dialog' && role !== 'form' && role !== 'list')) walk(c, depth + 1);
    }
  };
  var root = document.body;
  if (scopeRef) {
    var w = store.map.get(scopeRef);
    root = w && w.deref();
    if (!root || !root.isConnected) return { error: 'browser_stale_ref' };
  }
  if (root) walk(root, 0);
  return { title: document.title, url: location.href, text: lines.join('\n'), truncated: truncated };
})`

/**
 * `(ref, scroll) => { rect, tag, type, editable, disabled, inView } | { error }` — element for a ref.
 * With `scroll`, brings it into view first (like a user scrolling to it). Isolated world.
 */
export const RESOLVE_REF = String.raw`(function (ref, scroll) {
  var store = window.__piDesktopRefs;
  var w = store && store.map.get(ref);
  var el = w && w.deref();
  if (!el || !el.isConnected) return { error: 'browser_stale_ref' };
  var r = el.getBoundingClientRect();
  var inView = r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth;
  if (scroll && !inView) { el.scrollIntoView({ block: 'center', inline: 'center' }); r = el.getBoundingClientRect(); }
  var cs = getComputedStyle(el);
  return {
    rect: { x: r.x, y: r.y, width: r.width, height: r.height },
    tag: el.tagName.toLowerCase(),
    type: (el.getAttribute('type') || '').toLowerCase(),
    editable: el.isContentEditable || /^(input|textarea)$/i.test(el.tagName),
    disabled: !!el.disabled || el.getAttribute('aria-disabled') === 'true',
    visible: r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none',
    viewport: { width: innerWidth, height: innerHeight }
  };
})`

/** `(ref) => true | { error }` — focus a text field and select its content so typed text replaces it. */
export const SELECT_FIELD = String.raw`(function (ref) {
  var w = window.__piDesktopRefs && window.__piDesktopRefs.map.get(ref);
  var el = w && w.deref();
  if (!el || !el.isConnected) return { error: 'browser_stale_ref' };
  el.focus();
  if (typeof el.select === 'function') el.select();
  else { var range = document.createRange(); range.selectNodeContents(el); var s = getSelection(); s.removeAllRanges(); s.addRange(range); }
  return true;
})`

/** `(ref, value) => { selected } | { error }` — pick a <select> option by value or visible label. */
export const SELECT_OPTION = String.raw`(function (ref, value) {
  var w = window.__piDesktopRefs && window.__piDesktopRefs.map.get(ref);
  var el = w && w.deref();
  if (!el || !el.isConnected) return { error: 'browser_stale_ref' };
  if (el.tagName.toLowerCase() !== 'select') return { error: 'browser_denied: not a <select>' };
  var opt = Array.prototype.find.call(el.options, function (o) { return o.value === value || o.label.trim() === value || o.text.trim() === value; });
  if (!opt) return { error: 'browser_denied: no option ' + JSON.stringify(value) };
  el.value = opt.value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  return { selected: opt.value };
})`

/** `(ref, files[{name,type,base64}]) => { count } | { error }` — set files on a file input. */
export const SET_FILES = String.raw`(function (ref, files) {
  var w = window.__piDesktopRefs && window.__piDesktopRefs.map.get(ref);
  var el = w && w.deref();
  if (!el || !el.isConnected) return { error: 'browser_stale_ref' };
  if (!(el.tagName.toLowerCase() === 'input' && el.type === 'file')) return { error: 'browser_denied: not a file input' };
  var dt = new DataTransfer();
  files.forEach(function (f) {
    var bin = atob(f.base64), bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    dt.items.add(new File([bytes], f.name, { type: f.type || 'application/octet-stream' }));
  });
  el.files = dt.files;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  return { count: dt.files.length };
})`

/** `(text) => boolean` — whether the page currently shows `text`. Isolated world. */
export const PAGE_HAS_TEXT = String.raw`(function (text) {
  return !!document.body && String(document.body.innerText !== undefined ? document.body.innerText : document.body.textContent).indexOf(text) >= 0;
})`
