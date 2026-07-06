/** 侧栏会话标题：pi JSONL name（/name）> 旧版本地 overlay > 首条消息等 fallback */
export function pickSessionListTitle(
  sdkTitle: string,
  sdkName?: string,
  localOverlay?: string,
): string {
  const fromPi = sdkName?.trim()
  if (fromPi) return fromPi
  const overlay = localOverlay?.trim()
  if (overlay) return overlay
  return sdkTitle
}