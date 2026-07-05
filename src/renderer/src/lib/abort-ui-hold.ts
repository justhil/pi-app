let abortUiHoldUntil = 0

export function markAbortUiHold(ms = 2800): void {
  abortUiHoldUntil = Date.now() + ms
}

export function isAbortUiHoldActive(): boolean {
  return Date.now() < abortUiHoldUntil
}

export function clearAbortUiHold(): void {
  abortUiHoldUntil = 0
}