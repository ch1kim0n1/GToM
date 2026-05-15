import { GTOM_RUBRIC_V1 } from './gtom-rubric.js';

export type ApiStabilityLevel = 'alpha' | 'beta' | 'stable';

export interface ApiSurfaceStability {
  surface: string;
  level: ApiStabilityLevel;
  since: string;
  notes: string;
}

export interface SchemaMigrationRecord {
  from: number;
  to: number;
  description: string;
}

export const GTOM_PACKAGE_VERSION = '0.1.0';
export const CURRENT_RECEIPT_SCHEMA_VERSION = 2;
export const SUPPORTED_RECEIPT_SCHEMA_VERSIONS = [1, 2] as const;
export const RELEASE_TAG_PREFIX = 'gtom-v';

export const API_STABILITY: Record<string, ApiSurfaceStability> = {
  cli: {
    surface: 'cli',
    level: 'beta',
    since: '0.1.0',
    notes: 'Command names and JSON output fields are intended to be backward-compatible within a major version.',
  },
  http: {
    surface: 'http',
    level: 'beta',
    since: '0.1.0',
    notes: 'HTTP endpoints keep additive response changes within minor releases; removals require a major release.',
  },
  mcp: {
    surface: 'mcp',
    level: 'beta',
    since: '0.1.0',
    notes: 'MCP tool names and required parameters are stable within a major release.',
  },
  receipts: {
    surface: 'receipts',
    level: 'stable',
    since: '0.1.0',
    notes: 'Receipt schema migrations are explicit and must preserve old receipts through migrateReceipt.',
  },
  rubric: {
    surface: 'rubric',
    level: 'beta',
    since: '0.1.0',
    notes: 'Rubric version changes require a migration note and regression baseline update.',
  },
};

export const RECEIPT_SCHEMA_MIGRATIONS: SchemaMigrationRecord[] = [
  {
    from: 0,
    to: 1,
    description: 'Normalize legacy receipts into execution receipt schema v1 and preserve audit metadata.',
  },
  {
    from: 1,
    to: 2,
    description: 'Attach schema history, API stability, and rubric version metadata without changing score semantics.',
  },
];

export const RUBRIC_VERSION_MIGRATIONS: SchemaMigrationRecord[] = [
  {
    from: 0,
    to: 1,
    description: `Adopt ${GTOM_RUBRIC_V1.name}@${GTOM_RUBRIC_V1.version} with five weighted GToM quality dimensions.`,
  },
];

export function isSupportedReceiptSchemaVersion(version: number): boolean {
  return SUPPORTED_RECEIPT_SCHEMA_VERSIONS.includes(version as 1 | 2);
}

export function getVersionMetadata(): Record<string, unknown> {
  return {
    package_version: GTOM_PACKAGE_VERSION,
    receipt_schema_version: CURRENT_RECEIPT_SCHEMA_VERSION,
    supported_receipt_schema_versions: [...SUPPORTED_RECEIPT_SCHEMA_VERSIONS],
    release_tag_prefix: RELEASE_TAG_PREFIX,
    api_stability: API_STABILITY,
    rubric: {
      name: GTOM_RUBRIC_V1.name,
      version: GTOM_RUBRIC_V1.version,
      stability: API_STABILITY.rubric.level,
      migrations: RUBRIC_VERSION_MIGRATIONS,
    },
  };
}

