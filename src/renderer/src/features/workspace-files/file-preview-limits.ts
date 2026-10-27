/** 面板默认读取前 280KB；用户可按需读取到 shared 上限。 */
export const PREVIEW_READ_MAX_BYTES = 280 * 1024

/** 超过则代码预览不走 Shiki，仅纯文本 */
export const PREVIEW_SHIKI_MAX_CHARS = 80_000

/** 超过则 Markdown 先给源码，用户可一键渲染（长文档如 authoring guide 也想看排版）。 */
export const PREVIEW_MD_MAX_CHARS = 400_000

export const PREVIEW_MD_MAX_LINES = 3000
