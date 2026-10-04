// aria2c console readout parsing, e.g.
//   [#2089b0 400.0KiB/33.2MiB(1%) CN:16 DL:15.7MiB ETA:2s]
// Values use binary units (KiB, MiB, GiB) as aria2 prints them.

export interface Aria2Progress {
  received: number
  total: number
  speed: number
  connections: number
}

const UNITS: Record<string, number> = { B: 1, KiB: 1024, MiB: 1024 ** 2, GiB: 1024 ** 3, TiB: 1024 ** 4 }

export function parseSize(text: string): number {
  const m = /^([\d.]+)(B|KiB|MiB|GiB|TiB)$/.exec(text.trim())
  return m ? Math.round(Number(m[1]) * UNITS[m[2]]) : 0
}

/** The latest progress in a chunk of aria2 stdout (it may hold several readouts), or null. */
export function parseReadout(chunk: string): Aria2Progress | null {
  const all = [...chunk.matchAll(/\[#[0-9a-f]+ ([\d.]+(?:B|KiB|MiB|GiB|TiB))\/([\d.]+(?:B|KiB|MiB|GiB|TiB))(?:\(\d+%\))?(?: CN:(\d+))?(?: DL:([\d.]+(?:B|KiB|MiB|GiB|TiB)))?/g)]
  const m = all.at(-1)
  if (!m) return null
  return { received: parseSize(m[1]), total: parseSize(m[2]), connections: Number(m[3] ?? 0), speed: m[4] ? parseSize(m[4]) : 0 }
}

/**
 * aria2's input file for one download, fed on stdin (`--input-file=-`) so cookies and
 * headers never appear in the process list.
 */
export function aria2InputFile(opts: { url: string; dir: string; out: string; headers: Record<string, string> }): string {
  const clean = (v: string) => v.replace(/[\r\n]+/g, ' ')
  const lines = [clean(opts.url), `  dir=${clean(opts.dir)}`, `  out=${clean(opts.out)}`]
  for (const [k, v] of Object.entries(opts.headers)) if (v) lines.push(`  header=${clean(k)}: ${clean(v)}`)
  return `${lines.join('\n')}\n`
}
