// Bundle entry: installs the runtime once per document in the isolated world it is evaluated in.
// A newer build (different `version`) replaces an older one left behind by a hot app update.

import * as runtime from './index'

const g = globalThis as unknown as { __piBrowser?: typeof runtime }
if (!g.__piBrowser || g.__piBrowser.version !== runtime.version) {
  Object.defineProperty(g, '__piBrowser', { value: runtime, configurable: true, enumerable: false, writable: false })
}
