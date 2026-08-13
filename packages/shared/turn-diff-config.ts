/**
 * 回合文件最终净 diff 的共享配置（main 设置 ↔ worker 捕获 ↔ renderer 展示）。
 *
 * 快照上限语义：单个文件在本回合首次修改前的原始内容超过该值时不做缓存，
 * 无法生成本回合最终净 diff；0 = 关闭捕获。仅在 Worker 初始化时读取，修改后重启生效。
 */

export const TURN_DIFF_SNAPSHOT_DEFAULT_BYTES = 1024 * 1024 // 1 MiB
export const TURN_DIFF_SNAPSHOT_MAX_BYTES = 16 * 1024 * 1024 // 16 MiB
/** 单回合捕获预算 = 单文件上限 × 16，封顶 64 MiB。 */
export const TURN_DIFF_BUDGET_FACTOR = 16
export const TURN_DIFF_BUDGET_MAX_BYTES = 64 * 1024 * 1024

/** diff 文本输出上限（字符 / 行），超出截断并标记。 */
export const TURN_DIFF_TEXT_MAX_CHARS = 256 * 1024
export const TURN_DIFF_TEXT_MAX_LINES = 3000

export function normalizeTurnDiffSnapshotBytes(raw: unknown): number {
  const n = typeof raw === 'number' ? raw : Number(raw)
  if (!Number.isFinite(n) || n <= 0) return 0
  return Math.min(TURN_DIFF_SNAPSHOT_MAX_BYTES, Math.floor(n))
}

export function turnDiffBudgetBytes(cap: number): number {
  if (cap <= 0) return 0
  return Math.min(cap * TURN_DIFF_BUDGET_FACTOR, TURN_DIFF_BUDGET_MAX_BYTES)
}
