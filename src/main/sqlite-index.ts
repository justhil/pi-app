import { createRequire } from 'module'
import { app } from 'electron'
import { join } from 'path'

let nativeRequire: ReturnType<typeof createRequire> | null = null
function requireNative<T = unknown>(id: string): T {
  if (!nativeRequire) nativeRequire = createRequire(import.meta.url)
  return nativeRequire(id) as T
}

type SqliteStatement = { run: (...args: unknown[]) => void; all: (...args: unknown[]) => unknown[] }
type SqliteDb = { pragma: (s: string) => void; exec: (s: string) => void; prepare: (sql: string) => SqliteStatement }

let DatabaseCtor: (new (path: string) => SqliteDb) | null = null
let db: SqliteDb | null = null
let loadFailed = false

function loadBetterSqlite(): (new (path: string) => SqliteDb) | null {
  if (loadFailed) return null
  if (DatabaseCtor) return DatabaseCtor
  try {
    const pkg = requireNative<{ default?: unknown } & (new (path: string) => SqliteDb)>('better-sqlite3')
    DatabaseCtor = (pkg.default || pkg) as new (path: string) => SqliteDb
    return DatabaseCtor
  } catch (e) {
    loadFailed = true
    DatabaseCtor = null
    db = null
    console.warn(
      '[sqlite-index] better-sqlite3 unavailable; index disabled. Run: npx @electron/rebuild -f -w better-sqlite3',
      (e as Error).message,
    )
    return null
  }
}

function getDb(): SqliteDb | null {
  try {
    const Ctor = loadBetterSqlite()
    if (!Ctor) return null
    if (!db) {
      const dbPath = join(app.getPath('userData'), 'pi-desktop-index.db')
      db = new Ctor(dbPath)
      db.pragma('journal_mode = WAL')
      initSchema(db)
    }
    return db
  } catch (e) {
    loadFailed = true
    db = null
    console.warn('[sqlite-index] open db failed; index disabled:', (e as Error).message)
    return null
  }
}

function initSchema(d: SqliteDb): void {
  d.exec(`
    CREATE TABLE IF NOT EXISTS workspace_index (
      workspace_id TEXT PRIMARY KEY,
      name TEXT,
      path TEXT UNIQUE,
      last_opened INTEGER
    );
    CREATE TABLE IF NOT EXISTS session_index (
      session_id TEXT PRIMARY KEY,
      workspace_id TEXT,
      title TEXT,
      created_at INTEGER,
      updated_at INTEGER,
      model_id TEXT
    );
    CREATE TABLE IF NOT EXISTS run_index (
      run_id TEXT PRIMARY KEY,
      session_id TEXT,
      workspace_id TEXT,
      status TEXT,
      model TEXT,
      started_at INTEGER,
      ended_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS turn_index (
      turn_id TEXT PRIMARY KEY,
      run_id TEXT,
      session_id TEXT,
      started_at INTEGER,
      ended_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS file_change_index (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT,
      turn_id TEXT,
      path TEXT,
      source TEXT,
      change_type TEXT,
      timestamp INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_file_change_session ON file_change_index(session_id);
    CREATE INDEX IF NOT EXISTS idx_file_change_turn ON file_change_index(turn_id);
    CREATE TABLE IF NOT EXISTS extension_discovery (
      extension_id TEXT PRIMARY KEY,
      source TEXT,
      registered_tools TEXT,
      registered_commands TEXT,
      load_error TEXT,
      discovered_at INTEGER
    );
  `)
}

export const sqliteIndex = {
  upsertWorkspace(workspaceId: string, name: string, path: string): void {
    const d = getDb()
    if (!d) return
    d.prepare(
      'INSERT OR REPLACE INTO workspace_index (workspace_id, name, path, last_opened) VALUES (?, ?, ?, ?)',
    ).run(workspaceId, name, path, Date.now())
  },

  upsertSession(sessionId: string, workspaceId: string, title: string, modelId: string): void {
    const d = getDb()
    if (!d) return
    d.prepare(
      'INSERT OR REPLACE INTO session_index (session_id, workspace_id, title, created_at, updated_at, model_id) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(sessionId, workspaceId, title, Date.now(), Date.now(), modelId)
  },

  addFileChange(sessionId: string, turnId: string, path: string, source: string, changeType: string): void {
    const d = getDb()
    if (!d) return
    d.prepare(
      'INSERT INTO file_change_index (session_id, turn_id, path, source, change_type, timestamp) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(sessionId, turnId, path, source, changeType, Date.now())
  },

  getFileChangesBySession(sessionId: string): unknown[] {
    const d = getDb()
    if (!d) return []
    return d.prepare(
      'SELECT * FROM file_change_index WHERE session_id = ? ORDER BY timestamp DESC',
    ).all(sessionId)
  },

  getFileChangesByTurn(turnId: string): unknown[] {
    const d = getDb()
    if (!d) return []
    return d.prepare(
      'SELECT * FROM file_change_index WHERE turn_id = ? ORDER BY timestamp DESC',
    ).all(turnId)
  },

}