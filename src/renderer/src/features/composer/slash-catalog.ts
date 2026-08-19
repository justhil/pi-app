// 生效 SDK 内置斜杠命令清单的 renderer 侧缓存（唯一来源：worker `getBuiltins`，
// 经 `ipc:commands.builtins` 拉取后由 use-composer-slash 写入）。
// 拦截逻辑（slash-exec.ts）与 popover（use-composer-slash.ts）共用本模块，
// 保证「能拦截的不漏、未知斜杠透传」与 pi TUI 语义一致。

export interface SyncedBuiltin {
  name: string
  description: string
  argumentHint?: string
}

let syncedBuiltins: SyncedBuiltin[] = []

/** 同步尚未完成时的兜底集合（仅名字，不含行为；worker 就绪后会被真实清单覆盖）。 */
const FALLBACK_PI_BUILTIN_NAMES = new Set([
  'settings', 'model', 'scoped-models', 'export', 'import', 'share', 'copy',
  'name', 'session', 'changelog', 'hotkeys', 'fork', 'clone', 'tree', 'trust',
  'login', 'logout', 'new', 'compact', 'resume', 'reload', 'quit',
])

export function setSyncedBuiltins(list: SyncedBuiltin[]): void {
  syncedBuiltins = Array.isArray(list) ? list : []
}

export function getSyncedBuiltins(): SyncedBuiltin[] {
  return syncedBuiltins
}

/** 该名字是否是 pi 内置命令（同步清单优先，兜底集合兜底）。 */
export function isPiBuiltin(name: string): boolean {
  if (syncedBuiltins.length > 0) {
    return syncedBuiltins.some((b) => b.name === name)
  }
  return FALLBACK_PI_BUILTIN_NAMES.has(name)
}
