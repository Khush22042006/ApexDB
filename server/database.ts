import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { config } from './config.ts';

fs.mkdirSync(path.dirname(config.databasePath), { recursive: true });
export const db = new Database(config.databasePath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('synchronous = FULL');
db.pragma('busy_timeout = 5000');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('admin','editor','viewer')) DEFAULT 'viewer',
  disabled INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS refresh_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user ON refresh_tokens(user_id);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  method TEXT NOT NULL,
  path TEXT NOT NULL,
  status INTEGER NOT NULL,
  ip TEXT,
  user_agent TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at);

CREATE TABLE IF NOT EXISTS app_data (
  namespace TEXT NOT NULL,
  record_key TEXT NOT NULL,
  payload TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY(namespace, record_key)
);

CREATE TABLE IF NOT EXISTS schema_meta (
  schema_version INTEGER PRIMARY KEY,
  applied_at INTEGER NOT NULL
);
INSERT OR IGNORE INTO schema_meta(schema_version, applied_at) VALUES (1, ${Math.floor(Date.now() / 1000)});
`);

export function transaction<T>(fn: () => T): T {
  const run = db.transaction(fn);
  return run();
}

export function backupDatabase(destination: string): void {
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  db.backup(destination);
}

export function closeDatabase(): void {
  db.close();
}

export function pruneExpiredTokens(): number {
  const cutoff = Math.floor(Date.now() / 1000);
  const result = db.prepare(`DELETE FROM refresh_tokens WHERE expires_at < ? OR revoked_at IS NOT NULL AND revoked_at < ?`).run(cutoff, cutoff - 86400 * 30);
  return result.changes;
}

export function pruneBackups(directory: string, keep: number = 20): number {
  if (!fs.existsSync(directory)) return 0;
  const backups = fs.readdirSync(directory)
    .filter((name) => /^apex(?:-snapshot)?-\d+\.db$/.test(name))
    .map((name) => ({ name, path: path.join(directory, name), mtimeMs: fs.statSync(path.join(directory, name)).mtimeMs }))
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
  let removed = 0;
  for (const backup of backups.slice(Math.max(keep, 0))) {
    fs.rmSync(backup.path, { force: true });
    removed++;
  }
  return removed;
}
