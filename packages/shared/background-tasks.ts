export type BackgroundTaskStatus = 'running' | 'exited' | 'killed' | 'failed' | 'timed_out'

export interface BackgroundJobsLogFileRule {
  dirName: string
  filePattern: string
}

export type BackgroundJobsFieldMap = Partial<
  Record<
    | 'id'
    | 'command'
    | 'cwd'
    | 'status'
    | 'exitCode'
    | 'createdAt'
    | 'updatedAt'
    | 'outputPath'
    | 'lineCount'
    | 'tail'
    | 'timeoutSeconds'
    | 'error',
    string
  >
>

export interface BackgroundJobsProtocolSpec {
  adapterId: string
  tools: string[]
  exitMessageTypes: string[]
  statusKeys: string[]
  inspectTool?: string
  killTool?: string
  logFile?: BackgroundJobsLogFileRule
  fields?: BackgroundJobsFieldMap
  icon?: string
  title?: string
}

export interface BackgroundTaskSnapshot {
  id: string
  command: string
  cwd?: string
  status: BackgroundTaskStatus
  exitCode: number | null
  createdAt: number
  updatedAt: number
  outputPath?: string
  lineCount: number
  tail: string
  timeoutSeconds?: number
  error?: string
  sessionFile?: string
  /** Declaring adapter id (from background-jobs-v1). */
  adapterId?: string
}

export interface StatusBarClickAction {
  type: 'none' | 'slash' | 'open-panel' | 'config-page'
  command?: string
  panelId?: string
}

export interface StatusBarPillSnapshot {
  adapterId: string
  statusKey: string
  text: string
  icon?: string
  title?: string
  clickAction?: StatusBarClickAction
  updatedAt: number
}

const VALID_STATUSES = new Set<BackgroundTaskStatus>([
  'running',
  'exited',
  'killed',
  'failed',
  'timed_out',
])

/** Fallback spec used only when callers omit explicit adapter-derived specs (e.g. unit tests). */
export const DEFAULT_BACKGROUND_JOBS_SPEC: BackgroundJobsProtocolSpec = {
  adapterId: '@bytetrue/pi-background-terminal',
  tools: ['background_run', 'background_status', 'background_kill'],
  exitMessageTypes: ['background-exit'],
  statusKeys: ['background-terminal'],
  inspectTool: 'background_status',
  killTool: 'background_kill',
  logFile: {
    dirName: 'pi-background-terminal',
    filePattern: '^bg_[a-f0-9]+\\.log$',
  },
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

export function isBackgroundTerminalToolName(
  name: string | undefined,
  specs?: readonly BackgroundJobsProtocolSpec[],
): boolean {
  if (!name) return false
  const active = specs && specs.length > 0 ? specs : [DEFAULT_BACKGROUND_JOBS_SPEC]
  return active.some((spec) => spec.tools.includes(name))
}

function parseTimestampMs(raw: unknown): number {
  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) return raw
  if (raw instanceof Date) {
    const ms = raw.getTime()
    if (Number.isFinite(ms)) return ms
  }
  if (typeof raw === 'string' && raw.trim()) {
    const parsed = Date.parse(raw)
    if (Number.isFinite(parsed)) return parsed
  }
  return Date.now()
}

function readField(
  raw: Record<string, unknown>,
  canonicalKey: keyof BackgroundJobsFieldMap,
  fields?: BackgroundJobsFieldMap,
): unknown {
  const mapped = fields?.[canonicalKey]
  if (mapped && mapped in raw) return raw[mapped]
  return raw[canonicalKey]
}

export function normalizeBackgroundTask(
  raw: unknown,
  sessionFile?: string,
  fallbackUpdatedAt?: number,
  opts?: { fields?: BackgroundJobsFieldMap; adapterId?: string },
): BackgroundTaskSnapshot | null {
  if (!isRecord(raw)) return null
  const f = opts?.fields
  const idVal = readField(raw, 'id', f)
  const cmdVal = readField(raw, 'command', f)
  const statusVal = readField(raw, 'status', f)
  const id = typeof idVal === 'string' ? idVal.trim() : ''
  const command = typeof cmdVal === 'string' ? cmdVal.trim() : ''
  const statusRaw = typeof statusVal === 'string' ? (statusVal as BackgroundTaskStatus) : null
  if (!id || !command || !statusRaw || !VALID_STATUSES.has(statusRaw)) return null

  const exitVal = readField(raw, 'exitCode', f)
  const exitCode =
    typeof exitVal === 'number' && Number.isFinite(exitVal) ? exitVal : null
  const createdVal = readField(raw, 'createdAt', f)
  const createdAt = parseTimestampMs(createdVal)
  const updatedVal = readField(raw, 'updatedAt', f)
  const updatedAt =
    updatedVal !== undefined
      ? parseTimestampMs(updatedVal)
      : fallbackUpdatedAt !== undefined && Number.isFinite(fallbackUpdatedAt)
        ? Math.max(createdAt, fallbackUpdatedAt)
        : statusRaw === 'running'
          ? Date.now()
          : createdAt
  const outVal = readField(raw, 'outputPath', f)
  const outputPath =
    typeof outVal === 'string' && outVal.trim() ? outVal.trim() : undefined
  const cwdVal = readField(raw, 'cwd', f)
  const cwd = typeof cwdVal === 'string' && cwdVal.trim() ? cwdVal.trim() : undefined
  const lcVal = readField(raw, 'lineCount', f)
  const lineCount =
    typeof lcVal === 'number' && Number.isFinite(lcVal) && lcVal >= 0
      ? Math.floor(lcVal)
      : 0
  const tailVal = readField(raw, 'tail', f)
  const tail = typeof tailVal === 'string' ? tailVal.slice(-8000) : ''
  const timeoutVal = readField(raw, 'timeoutSeconds', f)
  const timeoutSeconds =
    typeof timeoutVal === 'number' && Number.isFinite(timeoutVal) && timeoutVal > 0
      ? timeoutVal
      : undefined
  const errVal = readField(raw, 'error', f)
  const error = typeof errVal === 'string' && errVal.trim() ? errVal.trim() : undefined
  const sf =
    sessionFile?.trim() ||
    (typeof raw.sessionFile === 'string' && raw.sessionFile.trim()
      ? raw.sessionFile.trim()
      : undefined)
  const adapterId =
    opts?.adapterId?.trim() ||
    (typeof raw.adapterId === 'string' && raw.adapterId.trim() ? raw.adapterId.trim() : undefined)

  return {
    id,
    command,
    ...(cwd ? { cwd } : {}),
    status: statusRaw,
    exitCode,
    createdAt,
    updatedAt,
    ...(outputPath ? { outputPath } : {}),
    lineCount,
    tail,
    ...(timeoutSeconds !== undefined ? { timeoutSeconds } : {}),
    ...(error ? { error } : {}),
    ...(sf ? { sessionFile: sf } : {}),
    ...(adapterId ? { adapterId } : {}),
  }
}

export function parseBackgroundTaskDetails(
  raw: unknown,
  sessionFile?: string,
  fallbackUpdatedAt?: number,
  opts?: { fields?: BackgroundJobsFieldMap; adapterId?: string },
): BackgroundTaskSnapshot[] {
  if (!raw) return []
  if (Array.isArray(raw)) {
    return raw
      .map((item) => normalizeBackgroundTask(item, sessionFile, fallbackUpdatedAt, opts))
      .filter((item): item is BackgroundTaskSnapshot => item !== null)
  }
  const single = normalizeBackgroundTask(raw, sessionFile, fallbackUpdatedAt, opts)
  if (single) return [single]
  if (isRecord(raw) && 'details' in raw) {
    return parseBackgroundTaskDetails(raw.details, sessionFile, fallbackUpdatedAt, opts)
  }
  return []
}

export function mergeBackgroundTask(
  prev: BackgroundTaskSnapshot | undefined,
  next: BackgroundTaskSnapshot,
): BackgroundTaskSnapshot {
  if (!prev) return next
  const prevSettled = prev.status !== 'running'
  const nextRunning = next.status === 'running'
  if (prevSettled && nextRunning && next.updatedAt <= prev.updatedAt) {
    return prev
  }
  return {
    ...prev,
    ...next,
    createdAt: Math.min(prev.createdAt, next.createdAt),
    outputPath: next.outputPath || prev.outputPath,
    cwd: next.cwd || prev.cwd,
    tail: next.tail || prev.tail,
    lineCount: Math.max(next.lineCount, next.status === 'running' ? prev.lineCount : 0),
    sessionFile: next.sessionFile || prev.sessionFile,
    adapterId: next.adapterId || prev.adapterId,
  }
}

export function sortBackgroundTasks(
  tasks: Iterable<BackgroundTaskSnapshot>,
): BackgroundTaskSnapshot[] {
  return [...tasks].sort((a, b) => {
    const aRunning = a.status === 'running' ? 1 : 0
    const bRunning = b.status === 'running' ? 1 : 0
    if (aRunning !== bRunning) return bRunning - aRunning
    return b.createdAt - a.createdAt || a.id.localeCompare(b.id)
  })
}

/**
 * Reconstruct background jobs from persisted Pi session branch entries according to the
 * active `background-jobs-v1` adapter specs.
 */
export function extractBackgroundTasksFromBranchEntries(
  entries: readonly unknown[],
  sessionFile?: string,
  specs?: readonly BackgroundJobsProtocolSpec[],
): BackgroundTaskSnapshot[] {
  const activeSpecs = specs !== undefined ? specs : [DEFAULT_BACKGROUND_JOBS_SPEC]
  if (activeSpecs.length === 0) return []

  const map = new Map<string, BackgroundTaskSnapshot>()

  const ingest = (
    rawDetails: unknown,
    spec: BackgroundJobsProtocolSpec,
    fallbackTs?: number,
  ) => {
    for (const task of parseBackgroundTaskDetails(rawDetails, sessionFile, fallbackTs, {
      fields: spec.fields,
      adapterId: spec.adapterId,
    })) {
      map.set(task.id, mergeBackgroundTask(map.get(task.id), task))
    }
  }

  for (const entry of entries) {
    if (!isRecord(entry)) continue
    const parsedTs = entry.timestamp ? Date.parse(String(entry.timestamp)) : NaN
    const entryTs = Number.isFinite(parsedTs) ? parsedTs : undefined

    if (entry.type === 'custom_message' && typeof entry.customType === 'string') {
      const spec = activeSpecs.find((s) => s.exitMessageTypes.includes(entry.customType as string))
      if (spec) {
        ingest(entry.details, spec, entryTs)
        continue
      }
    }

    const msg = isRecord(entry.message) ? entry.message : null
    if (msg && msg.role === 'custom' && typeof msg.customType === 'string') {
      const spec = activeSpecs.find((s) => s.exitMessageTypes.includes(msg.customType as string))
      if (spec) {
        ingest(msg.details, spec, entryTs)
        continue
      }
    }

    if (msg && msg.role === 'toolResult' && typeof msg.toolName === 'string') {
      const spec = activeSpecs.find((s) => s.tools.includes(msg.toolName as string))
      if (spec) {
        ingest(msg.details, spec, entryTs)
      }
    }
  }

  return sortBackgroundTasks(map.values())
}

/**
 * Validate a background job log path strictly against adapter-declared `logFile` rules
 * (`dirName` single segment + `filePattern` filename regex; rejects null bytes and `..`).
 */
export function isSafeBackgroundLogPath(
  rawPath: string | undefined,
  rules?: readonly BackgroundJobsLogFileRule[],
): boolean {
  const s = String(rawPath ?? '').trim()
  if (!s || s.includes('\0') || s.includes('..')) return false
  const parts = s.replace(/\\/g, '/').split('/').filter(Boolean)
  if (parts.length < 2) return false
  const file = parts[parts.length - 1]
  const dir = parts[parts.length - 2]

  const activeRules =
    rules !== undefined
      ? rules
      : DEFAULT_BACKGROUND_JOBS_SPEC.logFile
        ? [DEFAULT_BACKGROUND_JOBS_SPEC.logFile]
        : []

  return activeRules.some((rule) => {
    if (!rule.dirName || dir !== rule.dirName) return false
    try {
      return new RegExp(rule.filePattern, 'i').test(file)
    } catch {
      return false
    }
  })
}
