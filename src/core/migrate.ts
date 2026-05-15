/**
 * Migration system for GToM
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { BrainEngine, Migration } from './engine.js';
import { globalObservability } from './observability.js';

export type MigrationDialect = 'sqlite' | 'postgres';

export class Migrator {
  private engine: BrainEngine;
  private migrations: Migration[] = [];
  private dialect: MigrationDialect;

  constructor(engine: BrainEngine, dialect: MigrationDialect = 'sqlite') {
    this.engine = engine;
    this.dialect = dialect;
  }

  registerMigration(migration: Migration): void {
    this.migrations.push(migration);
    this.migrations.sort((a, b) => a.version - b.version);
  }

  registerMigrations(migrations: Migration[]): void {
    for (const migration of migrations) {
      this.registerMigration(migration);
    }
  }

  async run(): Promise<void> {
    await this.engine.execute(`
      CREATE TABLE IF NOT EXISTS migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    const result = await this.engine.query<{ version: number }>(
      'SELECT MAX(version) as version FROM migrations'
    );
    const currentVersion = result.rows[0]?.version || 0;

    for (const migration of this.migrations) {
      if (migration.version > currentVersion) {
        globalObservability.logger.info('Running migration', { version: migration.version, name: migration.name });
        await this.engine.beginTransaction();
        try {
          await this.engine.execute(migration.up);
          await this.engine.execute(
            `INSERT INTO migrations (version, name) VALUES (${this.placeholder(1)}, ${this.placeholder(2)})`,
            [migration.version, migration.name]
          );
          await this.engine.commitTransaction();
        } catch (error) {
          await this.engine.rollbackTransaction();
          throw error;
        }
      }
    }
  }

  async rollback(targetVersion: number): Promise<void> {
    const result = await this.engine.query<{ version: number }>(
      'SELECT MAX(version) as version FROM migrations'
    );
    const currentVersion = result.rows[0]?.version || 0;

    for (let i = this.migrations.length - 1; i >= 0; i--) {
      const migration = this.migrations[i];
      if (migration.version > targetVersion && migration.version <= currentVersion) {
        globalObservability.logger.info('Rolling back migration', { version: migration.version, name: migration.name });
        await this.engine.beginTransaction();
        try {
          await this.engine.execute(migration.down);
          await this.engine.execute(
            `DELETE FROM migrations WHERE version = ${this.placeholder(1)}`,
            [migration.version]
          );
          await this.engine.commitTransaction();
        } catch (error) {
          await this.engine.rollbackTransaction();
          throw error;
        }
      }
    }
  }

  async getStatus(): Promise<{ current: number; pending: number }> {
    const result = await this.engine.query<{ version: number }>(
      'SELECT MAX(version) as version FROM migrations'
    );
    const currentVersion = result.rows[0]?.version || 0;
    const pending = this.migrations.filter(m => m.version > currentVersion).length;

    return { current: currentVersion, pending };
  }

  private placeholder(index: number): string {
    return this.dialect === 'postgres' ? `$${index}` : '?';
  }
}

export async function loadSqlMigrations(migrationsDir: string): Promise<Migration[]> {
  const entries = await fs.readdir(migrationsDir, { withFileTypes: true });
  const migrations: Migration[] = [];

  for (const entry of entries) {
    if (!entry.isFile() || !/^\d+_.+\.sql$/.test(entry.name)) continue;
    const fullPath = path.join(migrationsDir, entry.name);
    const content = await fs.readFile(fullPath, 'utf8');
    const match = /^(\d+)_(.+)\.sql$/.exec(entry.name);
    if (!match) continue;

    const parsed = parseSqlMigration(content, entry.name);
    migrations.push({
      version: Number(match[1]),
      name: match[2].replace(/_/g, ' '),
      up: parsed.up,
      down: parsed.down,
    });
  }

  return migrations.sort((a, b) => a.version - b.version);
}

export function parseSqlMigration(content: string, fileName = 'migration.sql'): { up: string; down: string } {
  const upMarker = '-- migrate:up';
  const downMarker = '-- migrate:down';
  const upIndex = content.indexOf(upMarker);
  const downIndex = content.indexOf(downMarker);

  if (upIndex === -1 || downIndex === -1 || downIndex <= upIndex) {
    throw new Error(`Migration ${fileName} must contain ${upMarker} and ${downMarker} sections`);
  }

  const up = content.slice(upIndex + upMarker.length, downIndex).trim();
  const down = content.slice(downIndex + downMarker.length).trim();
  if (!up || !down) {
    throw new Error(`Migration ${fileName} has an empty up or down section`);
  }
  return { up, down };
}

export const createMigrator = (engine: BrainEngine, dialect: MigrationDialect = 'sqlite'): Migrator => {
  return new Migrator(engine, dialect);
};
