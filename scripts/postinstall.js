#!/usr/bin/env node

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const childProcess = require('node:child_process');

if (process.env.GTOM_SKIP_POSTINSTALL === '1') {
  process.exit(0);
}

const root = path.join(__dirname, '..');
const migrationsDir = path.join(root, 'migrations');
const dbPath = process.env.GTOM_SQLITE_DB_PATH
  || path.join(os.homedir(), '.gtom', 'gtom.sqlite');

function rebuildBetterSqlite3() {
  try {
    childProcess.execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['rebuild', 'better-sqlite3'], {
      cwd: root,
      stdio: 'inherit',
    });
  } catch (error) {
    console.warn('[gtom] better-sqlite3 rebuild failed; install build tools and run npm rebuild better-sqlite3');
  }
}

function loadBetterSqlite3() {
  try {
    return require('better-sqlite3');
  } catch (error) {
    console.warn('[gtom] better-sqlite3 native binding is not available; attempting rebuild');
    rebuildBetterSqlite3();
    return require('better-sqlite3');
  }
}

function parseMigration(content, fileName) {
  const upMarker = '-- migrate:up';
  const downMarker = '-- migrate:down';
  const upIndex = content.indexOf(upMarker);
  const downIndex = content.indexOf(downMarker);
  if (upIndex === -1 || downIndex === -1 || downIndex <= upIndex) {
    throw new Error(`Invalid migration file ${fileName}`);
  }
  return content.slice(upIndex + upMarker.length, downIndex).trim();
}

try {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const Database = loadBetterSqlite3();
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE IF NOT EXISTS migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  if (fs.existsSync(migrationsDir)) {
    const migrations = fs.readdirSync(migrationsDir)
      .filter((entry) => /^\d+_.+\.sql$/.test(entry))
      .sort();
    for (const fileName of migrations) {
      const version = Number(fileName.split('_')[0]);
      const applied = db.prepare('SELECT 1 FROM migrations WHERE version = ?').get(version);
      if (applied) continue;
      const up = parseMigration(fs.readFileSync(path.join(migrationsDir, fileName), 'utf8'), fileName);
      const name = fileName.replace(/^\d+_/, '').replace(/\.sql$/, '').replace(/_/g, ' ');
      const tx = db.transaction(() => {
        db.exec(up);
        db.prepare('INSERT INTO migrations (version, name) VALUES (?, ?)').run(version, name);
      });
      tx();
    }
  }
  db.close();
  console.log(`[gtom] SQLite schema ready at ${dbPath}`);
} catch (error) {
  console.warn(`[gtom] postinstall schema setup skipped: ${error instanceof Error ? error.message : String(error)}`);
  console.warn('[gtom] Run npm rebuild better-sqlite3, then gtom health once native build tools are available.');
}
