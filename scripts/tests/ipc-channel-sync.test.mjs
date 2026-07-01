import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()

function walkTsFiles(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    const st = statSync(p)
    if (st.isDirectory()) walkTsFiles(p, out)
    else if (name.endsWith('.ts')) out.push(p)
  }
  return out
}

function extractAllowlist() {
  const src = readFileSync(join(root, 'packages/shared/ipc-channels.ts'), 'utf8')
  const m = src.match(/export const IPC_INVOKE_CHANNELS = \[([\s\S]*?)\] as const/)
  assert.ok(m, 'IPC_INVOKE_CHANNELS array')
  return [...m[1].matchAll(/'(ipc:[^']+)'/g)].map((x) => x[1])
}

function extractRegistered() {
  const dirs = [join(root, 'src/main'), join(root, 'src/main/ipc')]
  const files = []
  for (const d of dirs) {
    try {
      walkTsFiles(d, files)
    } catch {
      /* skip */
    }
  }
  const uniq = new Set()
  const re = /registerHandler\(\s*'(ipc:[^']+)'/g
  for (const file of files) {
    const text = readFileSync(file, 'utf8')
    let match
    while ((match = re.exec(text)) !== null) uniq.add(match[1])
  }
  return [...uniq].sort()
}

describe('IPC channel sync', () => {
  it('every allowlisted channel is registered in main', () => {
    const allow = extractAllowlist()
    const reg = new Set(extractRegistered())
    const missing = allow.filter((ch) => !reg.has(ch))
    assert.deepEqual(
      missing,
      [],
      `channels in ipc-channels.ts but not registerHandler: ${missing.join(', ')}`,
    )
  })

  it('every registerHandler channel is in allowlist', () => {
    const allow = new Set(extractAllowlist())
    const reg = extractRegistered()
    const extra = reg.filter((ch) => !allow.has(ch))
    assert.deepEqual(
      extra,
      [],
      `registerHandler without allowlist entry: ${extra.join(', ')}`,
    )
  })
})