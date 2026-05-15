/**
 * Core module exports for GToM
 */

export type { BrainEngine, EngineConfig, QueryOptions, QueryResult, DatabaseStats, Migration } from './engine.js';
export { SQLiteEngine } from './sqlite-engine.js';
export { createEngine, createDefaultEngine } from './engine-factory.js';
export { Migrator, createMigrator } from './migrate.js';
export { createBackup, restoreBackup, exportPersistenceSnapshot, getPersistenceRoots } from './persistence-tools.js';
export {
  Observability,
  MetricsRegistry,
  LocalLogger,
  LocalAuditLogger,
  Tracer,
  globalObservability,
  redactPII,
} from './observability.js';
export type { ShellJobAuditEntry, DecisionAuditEntry, SpanContext, LocalLogEntry } from './observability.js';

export { VulnerabilityRegistry } from './vulnerability-registry.js';
export type { Vulnerability } from './vulnerability-registry.js';
export { AuthenticityRegistry } from './authenticity-registry.js';
export type { AuthenticityAssessment } from './authenticity-registry.js';
export { ToMModel } from './tom-model.js';
export type { ToMModelConfig, ToMInference } from './tom-model.js';
export { VulnerabilityScanner } from './vulnerability-scanner.js';
export type { ScanResult } from './vulnerability-scanner.js';
export { AuthenticityAnalyzer } from './authenticity-analyzer.js';
export type { AuthenticityFactors, AuthenticityResult } from './authenticity-analyzer.js';

export { defaultConfig, loadConfig, mergeConfig } from './config.js';
export type { GToMConfig } from './config.js';
export { generateId, hashString, sleep, retry } from './utils.js';
export { Logger, LogLevel, logger } from './logger.js';
export type { LogEntry } from './logger.js';
export {
  GToMError,
  DatabaseError,
  ValidationError,
  VulnerabilityError,
  AuthenticityError,
  TheoryOfMindError,
} from './errors.js';
