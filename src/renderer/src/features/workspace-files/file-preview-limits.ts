/** 面板内预览读盘上限（小于 IPC 默认 1MB，减轻卡顿） */
export const PREVIEW_READ_MAX_BYTES = 280 * 1024

/** 超过则代码预览不走 Shiki，仅纯文本 */
export const PREVIEW_SHIKI_MAX_CHARS = 80_000

/** 超过则 Markdown 不走完整渲染 */
export const PREVIEW_MD_MAX_CHARS = 120_000

export const PREVIEW_MD_MAX_LINES = 800

export const PREVIEW_PLAIN_MAX_LINES = 400

export const PREVIEW_HTML_MAX_CHARS = 400_000