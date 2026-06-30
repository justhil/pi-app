/** 单次 listDir 返回条数上限（主进程截断） */
export const LIST_DIR_MAX_ENTRIES = 2500

/** 超过则展开动效改为瞬时，避免 grid 动画 + 大 DOM 卡死 */
export const FOLDER_EXPAND_ANIMATION_MAX_ENTRIES = 100

/** 每层首屏渲染行数 */
export const FOLDER_INITIAL_VISIBLE = 80

/** 「加载更多」步进 */
export const FOLDER_VISIBLE_STEP = 120

/** 搜索匹配结果每层最多渲染 */
export const SEARCH_MAX_VISIBLE_PER_LEVEL = 200