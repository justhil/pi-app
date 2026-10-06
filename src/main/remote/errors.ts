import type { ErrorCode } from '@shared/remote'

/** Error surfaced to a remote client as `{ ok: false, err }`. Anything else becomes `internal`. */
export class RpcFail extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string = code,
    readonly retryable = false,
  ) {
    super(message)
  }
}
