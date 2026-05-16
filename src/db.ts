import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

const DATA_DIR = process.env.GTOM_DATA_DIR || path.join(process.env.HOME || '/tmp', '.gtom');
fs.mkdirSync(DATA_DIR, { recursive: true });

let _db: ReturnType<typeof Database> | null = null;

export function getDb(): ReturnType<typeof Database> {
  if (_db) return _db;
  _db = new Database(path.join(DATA_DIR, 'gtom.db'));
  _db.exec(`
    CREATE TABLE IF NOT EXISTS analyses (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      dyad_id    TEXT NOT NULL DEFAULT 'default',
      mode       TEXT NOT NULL,
      result     TEXT NOT NULL,
      snippet    TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_dyad ON analyses (dyad_id, created_at);
  `);
  return _db;
}

export function saveAnalysis(dyad_id: string, mode: string, result: unknown, snippet?: string): void {
  try {
    const db = getDb();
    db.prepare(`
      INSERT INTO analyses (dyad_id, mode, result, snippet, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(dyad_id, mode, JSON.stringify(result), snippet?.slice(0, 200) ?? null, new Date().toISOString());
  } catch {
    // non-fatal — SQLite may fail on Node v25
  }
}

export function getAnalyses(dyad_id?: string, limit = 20): any[] {
  try {
    const db = getDb();
    if (dyad_id) {
      return db.prepare('SELECT * FROM analyses WHERE dyad_id = ? ORDER BY created_at DESC LIMIT ?').all(dyad_id, limit) as any[];
    }
    return db.prepare('SELECT * FROM analyses ORDER BY created_at DESC LIMIT ?').all(limit) as any[];
  } catch {
    return [];
  }
}
