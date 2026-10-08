// Code for the page's own (main) world: browser_evaluate world:"main". Unlike the isolated
// world it sees the page's JavaScript — framework component instances, app state — which is
// how GenericAgent drives custom Vue/React widgets that ignore synthetic events.
// Plain JS strings: they run in the page, not in Node.

/**
 * `piComponent(el)`: the framework component that owns `el`.
 * - React (dev and prod): props from the DOM node's `__reactProps$…` (onChange, onClick, value…).
 * - Vue 3: `__vueParentComponent` (dev builds), else walk the app's vnode tree from the mount
 *   container's `_vnode` (prod builds keep only that).
 * `piJson(value)`: JSON-safe copy (cycles, functions, DOM nodes, depth-limited).
 */
export const MAIN_PRELUDE = String.raw`
const piComponent = (el) => {
  if (!el) return null;
  for (let n = el; n; n = n.parentElement) {
    const rk = Object.keys(n).find((k) => k.startsWith('__reactProps$'));
    if (rk) return { kind: 'react', props: n[rk], element: n };
    const vc = n.__vueParentComponent;
    if (vc) return { kind: 'vue', instance: vc, props: vc.props, setupState: vc.setupState, emit: vc.emit, exposed: vc.exposed };
  }
  let root = el;
  while (root && !root._vnode) root = root.parentElement;
  if (!root) return null;
  const find = (vnode, depth) => {
    if (!vnode || depth > 80) return null;
    const comp = vnode.component;
    if (comp) {
      const inner = find(comp.subTree, depth + 1);
      if (inner) return inner;
      const host = comp.subTree && comp.subTree.el;
      if (host && host.nodeType === 1 && (host === el || host.contains(el))) return comp;
      return null;
    }
    const kids = Array.isArray(vnode.children) ? vnode.children : [];
    for (const k of kids) {
      const r = find(k, depth + 1);
      if (r) return r;
    }
    return null;
  };
  const vc = find(root._vnode, 0);
  return vc ? { kind: 'vue', instance: vc, props: vc.props, setupState: vc.setupState, emit: vc.emit, exposed: vc.exposed } : null;
};
const piJson = (value) => {
  const seen = new WeakSet();
  const walk = (v, depth) => {
    if (v === null || typeof v !== 'object') {
      if (typeof v === 'function') return '[Function ' + (v.name || 'anonymous') + ']';
      if (typeof v === 'bigint') return String(v);
      return v === undefined ? null : v;
    }
    if (typeof Node !== 'undefined' && v instanceof Node) return '[' + (v.nodeName || 'Node').toLowerCase() + ']';
    if (seen.has(v)) return '[Circular]';
    if (depth > 6) return '[Object]';
    seen.add(v);
    if (Array.isArray(v)) return v.slice(0, 200).map((x) => walk(x, depth + 1));
    const out = {};
    let n = 0;
    for (const k in v) {
      if (n++ >= 200) break;
      try { out[k] = walk(v[k], depth + 1); } catch (e) { out[k] = '[Unreadable]'; }
    }
    return out;
  };
  return walk(value, 0);
};
`

/** The expression evaluate runs in the main world; `selector` points at the target element. */
export function mainWorldEval(fn: string, selector: string | null): string {
  return `(async () => {
${MAIN_PRELUDE}
const el = ${JSON.stringify(selector)} ? document.querySelector(${JSON.stringify(selector)}) : undefined;
if (${JSON.stringify(selector)} && !el) return { __error: { error: 'stale_ref', message: 'the element is gone; take a new snapshot' } };
const value = await (${fn})(el);
return { value: piJson(value) };
})()`
}
