import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import {
  MAX_CUSTOM_CSS_LENGTH,
  normalizeCustomTheme,
  type CustomTheme,
} from '@shared/custom-theme'
import {
  parseSnippetStyleSettings,
  type CssSnippetItem,
  type CssSnippetValues,
  type SavedThemePack,
} from '@shared/theme-pack'

const SAFE_ID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/i

export function sanitizeSlugId(input: string, fallbackPrefix = 'item'): string {
  const cleaned = input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
  if (cleaned && SAFE_ID_RE.test(cleaned)) return cleaned
  return `${fallbackPrefix}-${Date.now().toString(36)}`
}

export function assertSafePackId(id: string): string {
  const trimmed = id.trim()
  if (!SAFE_ID_RE.test(trimmed)) {
    throw new Error('invalid_pack_id')
  }
  return trimmed
}

/* ── Saved Theme Packs (`<root>/themes/<id>.json`) ───────────────────────── */

export async function listThemePacks(themesDir: string): Promise<SavedThemePack[]> {
  let entries
  try {
    entries = await readdir(themesDir, { withFileTypes: true })
  } catch {
    return []
  }
  const packs: SavedThemePack[] = []
  for (const d of entries) {
    if (!d.isFile() || !d.name.endsWith('.json')) continue
    const id = d.name.slice(0, -5)
    if (!SAFE_ID_RE.test(id)) continue
    try {
      const full = join(themesDir, d.name)
      const [raw, st] = await Promise.all([readFile(full, 'utf8'), stat(full)])
      const parsed = JSON.parse(raw) as Record<string, unknown>
      const theme = normalizeCustomTheme(parsed.theme)
      if (!theme.light && !theme.dark) continue
      packs.push({
        id,
        name: typeof parsed.name === 'string' && parsed.name.trim() ? parsed.name.trim().slice(0, 60) : id,
        updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : Math.round(st.mtimeMs),
        theme,
        ...(typeof parsed.customCss === 'string' && parsed.customCss
          ? { customCss: parsed.customCss.slice(0, MAX_CUSTOM_CSS_LENGTH) }
          : {}),
      })
    } catch {
      /* ignore malformed file */
    }
  }
  return packs.sort((a, b) => b.updatedAt - a.updatedAt || a.name.localeCompare(b.name))
}

export async function saveThemePack(
  themesDir: string,
  input: { id?: string; name: string; theme: CustomTheme; customCss?: string },
): Promise<SavedThemePack> {
  const name = input.name.trim().slice(0, 60) || 'Custom Theme'
  const id = input.id ? assertSafePackId(input.id) : `${sanitizeSlugId(name, 'theme')}-${Date.now().toString(36).slice(-4)}`
  const theme = normalizeCustomTheme(input.theme)
  const updatedAt = Date.now()
  const pack: SavedThemePack = {
    id,
    name,
    updatedAt,
    theme,
    ...(typeof input.customCss === 'string' && input.customCss.trim()
      ? { customCss: input.customCss.slice(0, MAX_CUSTOM_CSS_LENGTH) }
      : {}),
  }
  await mkdir(themesDir, { recursive: true })
  await writeFile(join(themesDir, `${id}.json`), JSON.stringify(pack, null, 2), 'utf8')
  return pack
}

export async function deleteThemePack(themesDir: string, id: string): Promise<boolean> {
  const safeId = assertSafePackId(id)
  try {
    await rm(join(themesDir, `${safeId}.json`), { force: true })
    return true
  } catch {
    return false
  }
}

export async function importThemePackFromPath(
  themesDir: string,
  sourcePath: string,
): Promise<{ ok: boolean; item?: SavedThemePack; error?: string }> {
  try {
    const raw = await readFile(sourcePath, 'utf8')
    const parsed = JSON.parse(raw) as Record<string, unknown>
    const candidateTheme = normalizeCustomTheme(parsed.theme ?? parsed)
    if (!candidateTheme.light && !candidateTheme.dark) {
      return { ok: false, error: 'invalid_theme_json' }
    }
    const fallbackName = basename(sourcePath).replace(/\.json$/i, '') || 'Imported Theme'
    const name = typeof parsed.name === 'string' && parsed.name.trim() ? parsed.name.trim() : fallbackName
    const customCss = typeof parsed.customCss === 'string' ? parsed.customCss : undefined
    const saved = await saveThemePack(themesDir, { name, theme: candidateTheme, customCss })
    return { ok: true, item: saved }
  } catch {
    return { ok: false, error: 'read_failed' }
  }
}

/* ── CSS Snippets (`<root>/snippets/<id>.css` + `_state.json`) ───────────── */

type SnippetMetaRecord = Record<
  string,
  { name?: string; enabled?: boolean; values?: CssSnippetValues }
>

const STATE_FILE = '_state.json'

async function readSnippetMeta(snippetsDir: string): Promise<SnippetMetaRecord> {
  try {
    const raw = await readFile(join(snippetsDir, STATE_FILE), 'utf8')
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as SnippetMetaRecord)
      : {}
  } catch {
    return {}
  }
}

async function writeSnippetMeta(snippetsDir: string, meta: SnippetMetaRecord): Promise<void> {
  await mkdir(snippetsDir, { recursive: true })
  await writeFile(join(snippetsDir, STATE_FILE), JSON.stringify(meta, null, 2), 'utf8')
}

function sanitizeValues(raw: unknown): CssSnippetValues {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const out: CssSnippetValues = {}
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
      out[k] = v
    }
  }
  return out
}

export async function listCssSnippets(snippetsDir: string): Promise<CssSnippetItem[]> {
  let entries
  try {
    entries = await readdir(snippetsDir, { withFileTypes: true })
  } catch {
    return []
  }
  const meta = await readSnippetMeta(snippetsDir)
  const items: CssSnippetItem[] = []

  for (const d of entries) {
    if (!d.isFile() || !d.name.endsWith('.css')) continue
    const id = d.name.slice(0, -4)
    if (!SAFE_ID_RE.test(id)) continue
    try {
      const full = join(snippetsDir, d.name)
      const [rawCss, st] = await Promise.all([readFile(full, 'utf8'), stat(full)])
      const css = rawCss.slice(0, MAX_CUSTOM_CSS_LENGTH)
      const entryMeta = meta[id] ?? {}
      items.push({
        id,
        name: typeof entryMeta.name === 'string' && entryMeta.name.trim() ? entryMeta.name.trim() : id,
        enabled: entryMeta.enabled === true,
        updatedAt: Math.round(st.mtimeMs),
        css,
        controls: parseSnippetStyleSettings(css),
        values: sanitizeValues(entryMeta.values),
      })
    } catch {
      /* ignore */
    }
  }
  return items.sort((a, b) => a.name.localeCompare(b.name))
}

export async function saveCssSnippet(
  snippetsDir: string,
  input: { id?: string; name: string; css: string; enabled?: boolean },
): Promise<CssSnippetItem> {
  const name = input.name.trim().slice(0, 60) || 'Snippet'
  const id = input.id ? assertSafePackId(input.id) : `${sanitizeSlugId(name, 'snip')}-${Date.now().toString(36).slice(-4)}`
  const css = input.css.slice(0, MAX_CUSTOM_CSS_LENGTH)
  await mkdir(snippetsDir, { recursive: true })
  await writeFile(join(snippetsDir, `${id}.css`), css, 'utf8')

  const meta = await readSnippetMeta(snippetsDir)
  const prev = meta[id] ?? {}
  const enabled = input.enabled !== undefined ? Boolean(input.enabled) : prev.enabled ?? true
  const values = sanitizeValues(prev.values)
  meta[id] = { name, enabled, values }
  await writeSnippetMeta(snippetsDir, meta)

  return {
    id,
    name,
    enabled,
    updatedAt: Date.now(),
    css,
    controls: parseSnippetStyleSettings(css),
    values,
  }
}

export async function patchCssSnippet(
  snippetsDir: string,
  input: { id: string; enabled?: boolean; values?: CssSnippetValues; css?: string; name?: string },
): Promise<CssSnippetItem | null> {
  const safeId = assertSafePackId(input.id)
  const file = join(snippetsDir, `${safeId}.css`)
  let css: string
  try {
    if (typeof input.css === 'string') {
      css = input.css.slice(0, MAX_CUSTOM_CSS_LENGTH)
      await writeFile(file, css, 'utf8')
    } else {
      css = (await readFile(file, 'utf8')).slice(0, MAX_CUSTOM_CSS_LENGTH)
    }
  } catch {
    return null
  }

  const meta = await readSnippetMeta(snippetsDir)
  const prev = meta[safeId] ?? {}
  const nextName = typeof input.name === 'string' && input.name.trim() ? input.name.trim().slice(0, 60) : prev.name || safeId
  const nextEnabled = input.enabled !== undefined ? Boolean(input.enabled) : prev.enabled === true
  const nextValues = input.values ? { ...sanitizeValues(prev.values), ...sanitizeValues(input.values) } : sanitizeValues(prev.values)
  meta[safeId] = { name: nextName, enabled: nextEnabled, values: nextValues }
  await writeSnippetMeta(snippetsDir, meta)

  return {
    id: safeId,
    name: nextName,
    enabled: nextEnabled,
    updatedAt: Date.now(),
    css,
    controls: parseSnippetStyleSettings(css),
    values: nextValues,
  }
}

export async function deleteCssSnippet(snippetsDir: string, id: string): Promise<boolean> {
  const safeId = assertSafePackId(id)
  try {
    await rm(join(snippetsDir, `${safeId}.css`), { force: true })
    const meta = await readSnippetMeta(snippetsDir)
    if (safeId in meta) {
      delete meta[safeId]
      await writeSnippetMeta(snippetsDir, meta)
    }
    return true
  } catch {
    return false
  }
}
