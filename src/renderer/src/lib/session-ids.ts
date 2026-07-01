/** 侧栏选中：临时对话占位（未建 sandbox） */
export const EPHEMERAL_DRAFT_SESSION_ID = '__ephemeral_draft__'

/** 侧栏选中：项目内新会话占位（未 session.new） */
export const PENDING_NEW_SESSION_ID = '__pending_new__'

export function isPlaceholderSessionId(id: string | null | undefined): boolean {
  return id === EPHEMERAL_DRAFT_SESSION_ID || id === PENDING_NEW_SESSION_ID
}