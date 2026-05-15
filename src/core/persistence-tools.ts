import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { BudgetLedger } from './budget-ledger.js';
import { ReceiptRegistry } from './receipt-registry.js';
import { loadSqlMigrations } from './migrate.js';

export interface PersistenceRoot {
  name: 'local_state' | 'receipts' | 'user_audit' | 'custom';
  path: string;
  exists: boolean;
}

export interface BackupOptions {
  cwd?: string;
  homeDir?: string;
  outputDir?: string;
  sourceDir?: string;
  rotateKeep?: number;
  now?: Date;
}

export interface BackupResult {
  backup_dir: string;
  manifest_path: string;
  created_at: string;
  roots: PersistenceRoot[];
  rotation_removed: string[];
}

export interface RestoreOptions {
  cwd?: string;
  homeDir?: string;
  backupDir: string;
}

export interface RestoreResult {
  backup_dir: string;
  restored: Array<{ name: string; target: string }>;
}

export interface ExportOptions {
  cwd?: string;
  homeDir?: string;
  migrationsDir?: string;
}

export async function getPersistenceRoots(options: BackupOptions = {}): Promise<PersistenceRoot[]> {
  if (options.sourceDir) {
    const sourcePath = path.resolve(options.sourceDir);
    return [{ name: 'custom', path: sourcePath, exists: await directoryExists(sourcePath) }];
  }

  const cwd = options.cwd ?? process.cwd();
  const homeDir = options.homeDir ?? os.homedir();
  const roots: PersistenceRoot[] = [
    { name: 'local_state', path: path.join(cwd, '.gtom'), exists: false },
    { name: 'receipts', path: path.join(cwd, 'gtom', 'test', 'baselines'), exists: false },
    { name: 'user_audit', path: path.join(homeDir, '.gtom', 'audit'), exists: false },
  ];

  for (const root of roots) {
    root.exists = await directoryExists(root.path);
  }
  return roots;
}

export async function createBackup(options: BackupOptions = {}): Promise<BackupResult> {
  const cwd = options.cwd ?? process.cwd();
  const outputDir = path.resolve(options.outputDir ?? path.join(cwd, '.gtom', 'backups'));
  const createdAt = (options.now ?? new Date()).toISOString();
  const backupDir = path.join(outputDir, `gtom-backup-${createdAt.replace(/[:.]/g, '-')}`);
  const dataDir = path.join(backupDir, 'data');
  const roots = await getPersistenceRoots(options);

  await fs.mkdir(dataDir, { recursive: true });
  for (const root of roots.filter((item) => item.exists)) {
    await copyDirectory(root.path, path.join(dataDir, root.name), root.name === 'local_state' ? new Set(['backups']) : new Set());
  }

  const manifest = {
    schema_version: 1,
    created_at: createdAt,
    roots,
  };
  const manifestPath = path.join(backupDir, 'manifest.json');
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
  const rotationRemoved = await rotateBackups(outputDir, options.rotateKeep ?? 10);

  return {
    backup_dir: backupDir,
    manifest_path: manifestPath,
    created_at: createdAt,
    roots,
    rotation_removed: rotationRemoved,
  };
}

export async function restoreBackup(options: RestoreOptions): Promise<RestoreResult> {
  const backupDir = path.resolve(options.backupDir);
  const dataDir = path.join(backupDir, 'data');
  const cwd = options.cwd ?? process.cwd();
  const homeDir = options.homeDir ?? os.homedir();
  const restoreTargets: Record<string, string> = {
    local_state: path.join(cwd, '.gtom'),
    receipts: path.join(cwd, 'gtom', 'test', 'baselines'),
    user_audit: path.join(homeDir, '.gtom', 'audit'),
    custom: cwd,
  };
  const restored: Array<{ name: string; target: string }> = [];
  const entries = await fs.readdir(dataDir, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const target = restoreTargets[entry.name];
    if (!target) continue;
    await copyDirectory(path.join(dataDir, entry.name), target);
    restored.push({ name: entry.name, target });
  }

  return { backup_dir: backupDir, restored };
}

export async function exportPersistenceSnapshot(options: ExportOptions = {}): Promise<Record<string, unknown>> {
  const cwd = options.cwd ?? process.cwd();
  const homeDir = options.homeDir ?? os.homedir();
  const registry = new ReceiptRegistry('gtom', {
    baseDir: path.join(cwd, 'gtom', 'test', 'baselines'),
    postgresUrl: null,
  });
  const ledger = new BudgetLedger({
    maxBudgetUsd: Number(process.env.GTOM_MAX_BUDGET_USD ?? 1000),
    baseDir: homeDir,
  }, 'gtom');
  const migrationsDir = options.migrationsDir ?? path.join(cwd, 'migrations');
  const migrations = await loadSqlMigrations(migrationsDir).catch(() => []);
  const roots = await getPersistenceRoots({ cwd, homeDir });

  return {
    project: 'gtom',
    schema_version: 1,
    exported_at: new Date().toISOString(),
    persistence_roots: roots,
    receipts: await registry.getAllSince(new Date(0)),
    cost_summary: ledger.getSummary(),
    migrations: migrations.map((migration) => ({
      version: migration.version,
      name: migration.name,
    })),
  };
}

async function rotateBackups(outputDir: string, keep: number): Promise<string[]> {
  if (keep <= 0) return [];
  const entries = await fs.readdir(outputDir, { withFileTypes: true }).catch(() => []);
  const backups = entries
    .filter((entry) => entry.isDirectory() && entry.name.startsWith('gtom-backup-'))
    .map((entry) => path.join(outputDir, entry.name))
    .sort()
    .reverse();
  const removed = backups.slice(keep);
  for (const backup of removed) {
    await fs.rm(backup, { recursive: true, force: true });
  }
  return removed;
}

async function copyDirectory(source: string, target: string, excludeNames = new Set<string>()): Promise<void> {
  await fs.mkdir(target, { recursive: true });
  const entries = await fs.readdir(source, { withFileTypes: true });
  for (const entry of entries) {
    if (excludeNames.has(entry.name)) continue;
    const sourcePath = path.join(source, entry.name);
    const targetPath = path.join(target, entry.name);
    if (entry.isDirectory()) {
      await copyDirectory(sourcePath, targetPath, excludeNames);
    } else if (entry.isFile()) {
      await fs.mkdir(path.dirname(targetPath), { recursive: true });
      await fs.copyFile(sourcePath, targetPath);
    }
  }
}

async function directoryExists(dirPath: string): Promise<boolean> {
  try {
    return (await fs.stat(dirPath)).isDirectory();
  } catch {
    return false;
  }
}
