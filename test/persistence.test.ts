import { describe, expect, it } from '@jest/globals';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { SQLiteEngine } from '../src/core/sqlite-engine';
import { createMigrator, loadSqlMigrations } from '../src/core/migrate';
import { createBackup, exportPersistenceSnapshot, restoreBackup } from '../src/core/persistence-tools';

async function createTempDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'gtom-persistence-'));
}

describe('GToM persistence parity', () => {
  it('loads versioned SQL migrations and applies them transactionally', async () => {
    const tempDir = await createTempDir();
    const engine = new SQLiteEngine({
      type: 'sqlite',
      dbPath: path.join(tempDir, 'gtom.db'),
    });
    await engine.initialize();

    try {
      const migrations = await loadSqlMigrations(path.join(__dirname, '..', 'migrations'));
      const migrator = createMigrator(engine, 'sqlite');
      migrator.registerMigrations(migrations);

      await migrator.run();
      const status = await migrator.getStatus();
      const metadata = await engine.query<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
        ['gtom_persistence_metadata']
      );

      expect(migrations.map((migration) => migration.version)).toEqual([1, 2]);
      expect(status).toEqual({ current: 2, pending: 0 });
      expect(metadata.rowCount).toBe(1);
    } finally {
      await engine.close();
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it('backs up, rotates, restores, and exports persistence data', async () => {
    const tempDir = await createTempDir();
    const homeDir = path.join(tempDir, 'home');
    const stateDir = path.join(tempDir, '.gtom', 'data');
    const receiptDir = path.join(tempDir, 'gtom', 'test', 'baselines');
    await fs.mkdir(stateDir, { recursive: true });
    await fs.mkdir(receiptDir, { recursive: true });
    await fs.writeFile(path.join(stateDir, 'state.json'), '{"ok":true}', 'utf8');
    await fs.writeFile(path.join(receiptDir, 'schema.json'), '{"version":1,"created_at":"2026-01-01T00:00:00.000Z"}', 'utf8');

    try {
      await createBackup({
        cwd: tempDir,
        homeDir,
        rotateKeep: 1,
        now: new Date('2026-01-01T00:00:00.000Z'),
      });
      const backup = await createBackup({
        cwd: tempDir,
        homeDir,
        rotateKeep: 1,
        now: new Date('2026-01-02T00:00:00.000Z'),
      });
      const backupEntries = await fs.readdir(path.join(tempDir, '.gtom', 'backups'));
      expect(backupEntries).toHaveLength(1);

      await fs.rm(path.join(stateDir, 'state.json'), { force: true });
      const restore = await restoreBackup({
        cwd: tempDir,
        homeDir,
        backupDir: backup.backup_dir,
      });
      const restoredState = await fs.readFile(path.join(stateDir, 'state.json'), 'utf8');
      const snapshot = await exportPersistenceSnapshot({
        cwd: tempDir,
        homeDir,
        migrationsDir: path.join(__dirname, '..', 'migrations'),
      });

      expect(restore.restored.some((item) => item.name === 'local_state')).toBe(true);
      expect(restoredState).toBe('{"ok":true}');
      expect(snapshot.project).toBe('gtom');
      expect(snapshot.migrations).toEqual([
        { version: 1, name: 'initial persistence' },
        { version: 2, name: 'receipt indexes' },
      ]);
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });
});
