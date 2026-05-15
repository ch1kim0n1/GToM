/**
 * PostgreSQL engine implementation for GToM
 */

import { Pool, PoolClient } from 'pg';
import { BrainEngine, EngineConfig, QueryOptions, QueryResult, DatabaseStats } from './engine.js';

export class PostgreSQLEngine implements BrainEngine {
  private pool: Pool | null = null;
  private config: EngineConfig;
  private connectionCount = 0;
  private startTime = Date.now();
  private inTransaction = false;
  private client: PoolClient | null = null;

  constructor(config: EngineConfig) {
    this.config = config;
  }

  async initialize(): Promise<void> {
    const connectionString = this.config.connectionString || 'postgresql://localhost:5432/gtom';
    this.pool = new Pool({
      connectionString,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
    });
    this.connectionCount++;
  }

  async close(): Promise<void> {
    if (this.client) {
      await this.client.release();
      this.client = null;
    }
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
      this.connectionCount--;
    }
  }

  async query<T = unknown>(sql: string, params: unknown[] = [], options?: QueryOptions): Promise<QueryResult<T>> {
    if (!this.pool) {
      throw new Error('Database not initialized');
    }
    const client = this.client || await this.pool.connect();
    try {
      const result = await client.query(sql, params);
      return { rows: result.rows as T[], rowCount: result.rowCount || 0 };
    } finally {
      if (!this.client) {
        client.release();
      }
    }
  }

  async execute(sql: string, params: unknown[] = [], options?: QueryOptions): Promise<number> {
    if (!this.pool) {
      throw new Error('Database not initialized');
    }
    const client = this.client || await this.pool.connect();
    try {
      const result = await client.query(sql, params);
      return result.rowCount || 0;
    } finally {
      if (!this.client) {
        client.release();
      }
    }
  }

  async beginTransaction(): Promise<void> {
    if (!this.pool || this.inTransaction) {
      throw new Error('Transaction already in progress or database not initialized');
    }
    this.client = await this.pool.connect();
    await this.client.query('BEGIN');
    this.inTransaction = true;
  }

  async commitTransaction(): Promise<void> {
    if (!this.client || !this.inTransaction) {
      throw new Error('No transaction in progress');
    }
    await this.client.query('COMMIT');
    this.client.release();
    this.client = null;
    this.inTransaction = false;
  }

  async rollbackTransaction(): Promise<void> {
    if (!this.client || !this.inTransaction) {
      throw new Error('No transaction in progress');
    }
    await this.client.query('ROLLBACK');
    this.client.release();
    this.client = null;
    this.inTransaction = false;
  }

  async healthCheck(): Promise<boolean> {
    if (!this.pool) {
      return false;
    }
    try {
      const client = await this.pool.connect();
      await client.query('SELECT 1');
      client.release();
      return true;
    } catch {
      return false;
    }
  }

  async getStats(): Promise<DatabaseStats> {
    if (!this.pool) {
      throw new Error('Database not initialized');
    }
    const client = await this.pool.connect();
    try {
      const tableSizes: Record<string, number> = {};
      const tables = await client.query(`
        SELECT tablename 
        FROM pg_tables 
        WHERE schemaname = 'public'
      `);
      for (const table of tables.rows) {
        const result = await client.query(`SELECT COUNT(*) as count FROM ${table.tablename}`);
        tableSizes[table.tablename] = parseInt(result.rows[0].count);
      }
      return {
        totalSize: 0,
        tableSizes,
        connectionCount: this.connectionCount,
        uptime: Date.now() - this.startTime,
      };
    } finally {
      client.release();
    }
  }

  async migrate(): Promise<void> {
    if (this.pool) {
      const client = await this.pool.connect();
      try {
        await client.query(`
          CREATE TABLE IF NOT EXISTS migrations (
            version INTEGER PRIMARY KEY,
            name TEXT NOT NULL,
            applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          )
        `);
      } finally {
        client.release();
      }
    }
  }
}
