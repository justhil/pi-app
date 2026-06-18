import Database from 'better-sqlite3'
import { app } from 'electron'
import { join } from 'path'

let db: Database.Database | null = null

function getDb(): Database.Database {
  if (!db) {
    const dbPath = join(app.getPath('userData'), 'pi-desktop-index.db')
    db = new Database(dbPath)
    db.pragma('journal_mode = WAL')
    initSchema(db)
  }
  return db
}

function initSchema(d: Database.Database): void {
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
    CREATE TABLE IF NOT EXISTS registry_cache (
      key TEXT PRIMARY KEY,
      value TEXT,
      updated_at INTEGER
    );
  `)
}

export const sqliteIndex = {
  upsertWorkspace(workspaceId: string, name: string, path: string): void {
    getDb().prepare(
      'INSERT OR REPLACE INTO workspace_index (workspace_id, name, path, last_opened) VALUES (?, ?, ?, ?)',
    ).run(workspaceId, name, path, Date.now())
  },

  upsertSession(sessionId: string, workspaceId: string, title: string, modelId: string): void {
    getDb().prepare(
      'INSERT OR REPLACE INTO session_index (session_id, workspace_id, title, created_at, updated_at, model_id) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(sessionId, workspaceId, title, Date.now(), Date.now(), modelId)
  },

  addFileChange(sessionId: string, turnId: string, path: string, source: string, changeType: string): void {
    getDb().prepare(
      'INSERT INTO file_change_index (session_id, turn_id, path, source, change_type, timestamp) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(sessionId, turnId, path, source, changeType, Date.now())
  },

  getFileChangesBySession(sessionId: string): any[] {
    return getDb().prepare(
      'SELECT * FROM file_change_index WHERE session_id = ? ORDER BY timestamp DESC',
    ).all(sessionId)
  },

  getFileChangesByTurn(turnId: string): any[] {
    return getDb().prepare(
      'SELECT * FROM file_change_index WHERE turn_id = ? ORDER BY timestamp DESC',
    ).all(turnId)
  },

  setRegistryCache(key: string, value: string): void {
    getDb().prepare(
      'INSERT OR REPLACE INTO registry_cache (key, value, updated_at) VALUES (?, ?, ?)',
    ).run(key, value, Date.now())
  },

  getRegistryCache(key: string): string | null {
    const row = getDb().prepare('SELECT value FROM registry_cache WHERE key = ?').get(key) as any
    return row?.value ?? null
  },
}
