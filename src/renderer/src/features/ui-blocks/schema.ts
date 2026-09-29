/**
 * Tiny validator DSL for pi-ui props. Tolerant where models are predictably loose (numbers sent as
 * strings, "true" for booleans), strict about shape, and every failure carries a JSON path so the
 * fallback can say exactly what was wrong.
 */
export type Issue = { path: string; message: string }
type Ctx = { issues: Issue[] }
export type Validator<T> = ((value: unknown, path: string, ctx: Ctx) => T | undefined) & {
  optional?: boolean
}

function fail(ctx: Ctx, path: string, message: string): undefined {
  ctx.issues.push({ path, message })
  return undefined
}

function parseNumber(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined
  if (typeof value === 'string') {
    const cleaned = value.trim().replace(/[,\s_]/g, '')
    if (!cleaned) return undefined
    const parsed = Number(cleaned)
    return Number.isFinite(parsed) ? parsed : undefined
  }
  return undefined
}

export const v = {
  string(): Validator<string> {
    return (value, path, ctx) =>
      typeof value === 'string'
        ? value
        : typeof value === 'number' || typeof value === 'boolean'
          ? String(value)
          : fail(ctx, path, 'expected string')
  },
  number(): Validator<number> {
    return (value, path, ctx) => parseNumber(value) ?? fail(ctx, path, 'expected number')
  },
  /** A number or null (a gap in a series). */
  nullableNumber(): Validator<number | null> {
    return (value, path, ctx) =>
      value === null || value === undefined || value === '' ? null : (parseNumber(value) ?? fail(ctx, path, 'expected number or null'))
  },
  boolean(): Validator<boolean> {
    return (value, path, ctx) => {
      if (typeof value === 'boolean') return value
      if (value === 'true' || value === 1) return true
      if (value === 'false' || value === 0) return false
      return fail(ctx, path, 'expected boolean')
    }
  },
  enum<const T extends string>(values: readonly T[]): Validator<T> {
    return (value, path, ctx) => {
      const text = typeof value === 'string' ? value.trim().toLowerCase() : value
      return (values as readonly unknown[]).includes(text)
        ? (text as T)
        : fail(ctx, path, `expected one of ${values.join('|')}`)
    }
  },
  array<T>(item: Validator<T>, options: { min?: number; max?: number } = {}): Validator<T[]> {
    return (value, path, ctx) => {
      if (!Array.isArray(value)) return fail(ctx, path, 'expected array')
      if (options.min != null && value.length < options.min) return fail(ctx, path, `expected at least ${options.min} item(s)`)
      const source = options.max != null ? value.slice(0, options.max) : value
      const out: T[] = []
      source.forEach((entry, index) => {
        const parsed = item(entry, `${path}[${index}]`, ctx)
        if (parsed !== undefined) out.push(parsed)
      })
      return out
    }
  },
  object<T extends Record<string, unknown>>(shape: { [K in keyof T]: Validator<T[K]> }): Validator<T> {
    return (value, path, ctx) => {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) return fail(ctx, path, 'expected object')
      const source = value as Record<string, unknown>
      const out: Record<string, unknown> = {}
      for (const [key, validator] of Object.entries(shape) as Array<[string, Validator<unknown>]>) {
        const field = source[key]
        if (field === undefined || field === null) {
          if (!validator.optional) fail(ctx, `${path}.${key}`, 'required')
          continue
        }
        const parsed = validator(field, `${path}.${key}`, ctx)
        if (parsed !== undefined) out[key] = parsed
      }
      return out as T
    }
  },
  optional<T>(inner: Validator<T>): Validator<T | undefined> {
    const wrapped: Validator<T | undefined> = (value, path, ctx) => inner(value, path, ctx)
    wrapped.optional = true
    return wrapped
  },
  union<T>(...options: Validator<T>[]): Validator<T> {
    return (value, path, ctx) => {
      for (const option of options) {
        const trial: Ctx = { issues: [] }
        const parsed = option(value, path, trial)
        if (parsed !== undefined && trial.issues.length === 0) return parsed
      }
      return fail(ctx, path, 'no matching shape')
    }
  },
  /** Arbitrary check; `parse` returns undefined to reject with `message`. */
  custom<T>(parse: (value: unknown) => T | undefined, message: string): Validator<T> {
    return (value, path, ctx) => parse(value) ?? fail(ctx, path, message)
  },
  record(): Validator<Record<string, unknown>> {
    return (value, path, ctx) =>
      typeof value === 'object' && value !== null && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : fail(ctx, path, 'expected object')
  },
}

export function validate<T>(validator: Validator<T>, value: unknown):
  | { ok: true; value: T }
  | { ok: false; issues: Issue[] } {
  const ctx: Ctx = { issues: [] }
  const parsed = validator(value, '$', ctx)
  if (ctx.issues.length > 0 || parsed === undefined) {
    return { ok: false, issues: ctx.issues.length ? ctx.issues : [{ path: '$', message: 'invalid' }] }
  }
  return { ok: true, value: parsed }
}
