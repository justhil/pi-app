/**
 * Page scripts that must run in the page's MAIN world, kept as plain JS source strings (not
 * `fn.toString()`) so the bundler cannot rewrite them. Everything that can run in the isolated
 * world lives in the page runtime instead (src/browser-runtime/page).
 */

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
