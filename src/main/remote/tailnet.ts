import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { isPrivateHost } from '@shared/remote'

/** Where the Tailscale CLI lives when it is not on PATH (GUI installs). */
function candidates(): string[] {
  if (process.platform === 'win32') return [`${process.env.ProgramFiles || 'C:\\Program Files'}\\Tailscale\\tailscale.exe`, 'tailscale.exe']
  if (process.platform === 'darwin') return ['/Applications/Tailscale.app/Contents/MacOS/Tailscale', '/usr/local/bin/tailscale', '/opt/homebrew/bin/tailscale', 'tailscale']
  return ['tailscale']
}

function run(bin: string): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(bin, ['status', '--json', '--peers=false'], { timeout: 3000, windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => resolve(err ? null : stdout))
  })
}

/** Parse `tailscale status --json`: this machine's MagicDNS name, when it is online. */
export function parseTailnetName(json: string): string | null {
  try {
    const status = JSON.parse(json) as { BackendState?: string; Self?: { DNSName?: string; Online?: boolean } }
    if (status.BackendState && status.BackendState !== 'Running') return null
    const name = status.Self?.DNSName?.replace(/\.$/, '').toLowerCase()
    return name && isPrivateHost(name) ? name : null
  } catch {
    return null
  }
}

/** This machine's Tailscale MagicDNS name (`pc.tail1234.ts.net`), or null without a running Tailscale. */
export async function detectTailnetName(): Promise<string | null> {
  for (const bin of candidates()) {
    if (bin.includes('/') || bin.includes('\\')) {
      if (!existsSync(bin)) continue
    }
    const out = await run(bin)
    if (out) return parseTailnetName(out)
  }
  return null
}
