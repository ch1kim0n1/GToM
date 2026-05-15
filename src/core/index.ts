/**
 * Core module exports for GToM
 */

export type { BrainEngine, EngineConfig, QueryOptions, QueryResult, DatabaseStats, Migration } from './engine.js';
export { SQLiteEngine } from './sqlite-engine.js';
export { createEngine, createDefaultEngine } from './engine-factory.js';
export { Migrator, createMigrator } from './migrate.js';
export { createBackup, restoreBackup, exportPersistenceSnapshot, getPersistenceRoots } from './persistence-tools.js';
export { GBrainClient, emptyCognitiveResponse } from './gbrain-client.js';
export type {
  GBrainClientConfig,
  GBrainIntegrationMode,
  GBrainMCPClient,
  GBrainOperationResult,
  GBrainHealth,
  GBrainPageInput,
  GBrainWhoKnowsQuery,
  GBrainWhoKnowsResult,
  CircuitBreakerState,
} from './gbrain-client.js';
export { GStackGBrainSync } from './gstack-gbrain-sync.js';
export type {
  GStackGBrainSyncArgs,
  GStackGBrainSyncMode,
  GStackGBrainStageResult,
  GStackGBrainSyncState,
  GStackGBrainSyncConfig,
  ToolRoot,
  SpawnRunner,
} from './gstack-gbrain-sync.js';
export {
  Observability,
  MetricsRegistry,
  LocalLogger,
  LocalAuditLogger,
  Tracer,
  globalObservability,
  redactPII,
} from './observability.js';
export type { ShellJobAuditEntry, DecisionAuditEntry, SecurityAuditEntry, SpanContext, LocalLogEntry } from './observability.js';
export { FileSecretManager, defaultSecretManager } from './secret-manager.js';
export type { StoredSecretMetadata, SetSecretOptions } from './secret-manager.js';
export { FixedWindowRateLimiter, PermissionManager, hashToken, hasRequiredScopes, scopesForRoles } from './security.js';
export type { AccessScope, PermissionRole, AccessPrincipal, RateLimitResult } from './security.js';
export { sanitizeIdentifier, sanitizeJsonValue, sanitizePath, sanitizeUrl, sanitizeUserString } from './input-sanitizer.js';
export type { SanitizeStringOptions } from './input-sanitizer.js';
export {
  CrossToolServiceDiscovery,
  InProcessCrossToolEventBus,
  runCrossToolTask,
} from './cross-tool-integration.js';
export type {
  CrossToolEvent,
  CrossToolTaskResult,
  GStackToolName,
  ServiceDescriptor,
  ServiceStatus,
} from './cross-tool-integration.js';
export {
  API_STABILITY,
  CURRENT_RECEIPT_SCHEMA_VERSION,
  GTOM_PACKAGE_VERSION,
  RECEIPT_SCHEMA_MIGRATIONS,
  RELEASE_TAG_PREFIX,
  RUBRIC_VERSION_MIGRATIONS,
  SUPPORTED_RECEIPT_SCHEMA_VERSIONS,
  getVersionMetadata,
  isSupportedReceiptSchemaVersion,
} from './versioning.js';
export type { ApiStabilityLevel, ApiSurfaceStability, SchemaMigrationRecord } from './versioning.js';
export {
  BackpressureController,
  CancellationToken,
  LRUCache,
  ProgressReporter,
  MODEL_RESOLUTION_CHAIN_8,
  captureMemoryProfile,
  resolveModelFromChain,
} from './performance.js';
export type {
  GToMOperationOptions,
  MemoryProfileSnapshot,
  ModelResolutionRequest,
  ModelResolutionTier,
  ProgressEvent,
  ProgressHandler,
} from './performance.js';

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
