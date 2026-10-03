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
