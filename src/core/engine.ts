/**
 * Base engine interface for GToM database abstraction
 */

export interface EngineConfig {
  type: 'postgres' | 'sqlite' | 'memory';
  connectionString?: string;
  readConnectionString?: string;
  dbPath?: string;
  maxConnections?: number;
  fallbackToMemory?: boolean;
}

export interface QueryOptions {
  transaction?: boolean;
  timeout?: number;
}

export interface QueryResult<T = unknown> {
  rows: T[];
  rowCount: number;
  affectedRows?: number;
}

export interface BrainEngine {
  initialize(): Promise<void>;
  close(): Promise<void>;
  query<T = unknown>(sql: string, params?: unknown[], options?: QueryOptions): Promise<QueryResult<T>>;
  execute(sql: string, params?: unknown[], options?: QueryOptions): Promise<number>;
  beginTransaction(): Promise<void>;
  commitTransaction(): Promise<void>;
  rollbackTransaction(): Promise<void>;
  healthCheck(): Promise<boolean>;
  getStats(): Promise<DatabaseStats>;
  migrate(): Promise<void>;
}

export interface DatabaseStats {
  totalSize: number;
  tableSizes: Record<string, number>;
  connectionCount: number;
  uptime: number;
}

export interface Migration {
  version: number;
  name: string;
  up: string;
  down: string;
}
