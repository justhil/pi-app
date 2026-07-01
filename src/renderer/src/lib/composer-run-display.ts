import { applyComposerDisplayMeta } from '@renderer/lib/session-display-meta'

/** 刷新输入框模型 / thinking 展示（Worker、pi 默认、lastModel 合并） */
export async function refreshComposerRunDisplay(): Promise<void> {
  await applyComposerDisplayMeta()
}