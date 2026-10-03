export type BrowserErrorCode =
  | 'browser_stale_ref'
  | 'browser_not_found'
  | 'browser_ambiguous'
  | 'browser_invalid_target'
  | 'browser_not_actionable'
  | 'browser_timeout'
  | 'browser_denied'
  | 'browser_unsupported'
  | 'browser_dialog_pending'
  | 'browser_no_tab'
  | 'browser_error'

/** Tool errors read by the model: `<code>: <what to do>`. */
export class BrowserToolError extends Error {
  constructor(
    readonly code: BrowserErrorCode,
    message: string,
  ) {
    super(`${code}: ${message}`)
  }
}

export type RuntimeError = { error: string; message: string }

export const isRuntimeError = (v: unknown): v is RuntimeError =>
  !!v && typeof v === 'object' && typeof (v as RuntimeError).error === 'string' && typeof (v as RuntimeError).message === 'string'

/** Page runtime results carry errors as values; turn them into tool errors. */
export function unwrap<T>(value: T | RuntimeError): T {
  if (isRuntimeError(value)) throw new BrowserToolError(`browser_${value.error}` as BrowserErrorCode, value.message)
  return value
}
