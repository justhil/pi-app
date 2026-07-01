#!/usr/bin/env node
/**
 * CI: fail on critical npm audit findings; log high/moderate for tracking.
 */
import { execSync } from 'node:child_process'

function runAudit(level) {
  try {
    execSync(`npm audit --audit-level=${level} --json`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] })
    return { ok: true, meta: null }
  } catch (e) {
    const out = e.stdout?.toString() || ''
    try {
      return { ok: false, meta: JSON.parse(out).metadata?.vulnerabilities }
    } catch {
      return { ok: false, meta: null }
    }
  }
}

const critical = runAudit('critical')
if (!critical.ok) {
  console.error('[ci-audit] critical vulnerabilities present — failing')
  process.exit(1)
}

const high = runAudit('high')
if (!high.ok && high.meta) {
  console.warn(
    `[ci-audit] high=${high.meta.high} moderate=${high.meta.moderate} (tracked; not failing CI until upstream fixes)`,
  )
} else {
  console.log('[ci-audit] no critical; high tier clear or unreported')
}