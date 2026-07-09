import { configStore } from './config-store'

/** setTimeout-safe max delay (ms). */
export const MAX_TIMER_DELAY_MS = 2_147_483_647

export const DEFAULT_MAX_SESSION_WORKERS = 4
export const DEFAULT_SESSION_WORKER_IDLE_TIMEOUT_MINUTES = 15

export function normalizeMaxSessionWorkers(raw: unknown): number {
  const n = typeof raw === 'number' ? raw : Number(raw)
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 1) return DEFAULT_MAX_SESSION_WORKERS
  if (n > Number.MAX_SAFE_INTEGER) return Number.MAX_SAFE_INTEGER
  return n
}

export function normalizeSessionWorkerIdleTimeoutMinutes(raw: unknown): number {
  const n = typeof raw === 'number' ? raw : Number(raw)
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) {
    return DEFAULT_SESSION_WORKER_IDLE_TIMEOUT_MINUTES
  }
  if (n > Number.MAX_SAFE_INTEGER) return Number.MAX_SAFE_INTEGER
  return n
}

/** 0 minutes => never idle-timeout. Otherwise clamp to timer-safe ms. */
export function minutesToIdleDelayMs(minutes: number): number | null {
  const m = normalizeSessionWorkerIdleTimeoutMinutes(minutes)
  if (m === 0) return null
  const maxMinutes = Math.floor(MAX_TIMER_DELAY_MS / 60_000)
  const safeMinutes = m > maxMinutes ? maxMinutes : m
  return safeMinutes * 60_000
}

export function readMaxSessionWorkers(): number {
  return normalizeMaxSessionWorkers(configStore.get('maxSessionWorkers'))
}

export function readSessionWorkerIdleTimeoutMinutes(): number {
  return normalizeSessionWorkerIdleTimeoutMinutes(configStore.get('sessionWorkerIdleTimeoutMinutes'))
}

export function readAlertOnBackgroundRunIdle(): boolean {
  return configStore.get('alertOnBackgroundRunIdle') === true
}
