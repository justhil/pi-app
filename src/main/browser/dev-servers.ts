import { createConnection } from 'node:net'

export interface LocalDevServer {
  port: number
  url: string
  label: string
}

const COMMON_DEV_PORTS: ReadonlyArray<{ port: number; label: string }> = [
  { port: 5173, label: 'Vite' },
  { port: 5174, label: 'Vite' },
  { port: 3000, label: 'Local 3000' },
  { port: 3001, label: 'Local 3001' },
  { port: 4173, label: 'Preview' },
  { port: 4321, label: 'Astro' },
  { port: 8000, label: 'Local 8000' },
  { port: 8080, label: 'Local 8080' },
]

function probePort(port: number, timeoutMs = 130): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = createConnection({ host: '127.0.0.1', port })
    let settled = false
    const finish = (ok: boolean) => {
      if (settled) return
      settled = true
      sock.destroy()
      resolve(ok)
    }
    sock.setTimeout(timeoutMs, () => finish(false))
    sock.once('connect', () => finish(true))
    sock.once('error', () => finish(false))
  })
}

export async function detectLocalDevServers(): Promise<LocalDevServer[]> {
  const results = await Promise.all(
    COMMON_DEV_PORTS.map(async (item) => ({
      ...item,
      alive: await probePort(item.port),
    })),
  )
  return results
    .filter((r) => r.alive)
    .map((r) => ({
      port: r.port,
      url: `http://localhost:${r.port}`,
      label: `${r.label} (:${r.port})`,
    }))
}
